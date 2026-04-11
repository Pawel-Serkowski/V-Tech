import json
from datetime import datetime, timezone
from typing import Any

import yaml
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import ValidationError

from ..db import get_database
from ..models import NodeConfig, NodeUploadRequest

router = APIRouter()


NODE_TYPE_ALIASES: dict[str, str] = {
    "ground": "ground_station",
    "groundstation": "ground_station",
    "ground_station": "ground_station",
    "base": "ground_station",
    "gateway": "ground_station",
    "sat": "satellite",
    "satellite": "satellite",
    "relay": "relay",
}


def _serialize_window(window: Any) -> dict[str, Any] | None:
    """Serialize a single contact window dict to a JSON-safe form.

    Converts datetime objects to ISO-8601 UTC strings and preserves any
    additional numeric fields (e.g. avg_range_km) that may be stored alongside
    start/end timestamps.
    """
    if not isinstance(window, dict):
        return None

    raw_start = window.get("start")
    raw_end = window.get("end")

    if raw_start is None or raw_end is None:
        return None

    serialized: dict[str, Any] = {
        "start": raw_start.isoformat() if isinstance(raw_start, datetime) else raw_start,
        "end": raw_end.isoformat() if isinstance(raw_end, datetime) else raw_end,
    }

    # Preserve optional numeric fields so workers and the visualizer can use them.
    for extra_key in ("avg_range_km", "bandwidth_bps"):
        if extra_key in window:
            serialized[extra_key] = window[extra_key]

    return serialized


def _serialize_node(node: dict[str, Any]) -> dict[str, Any]:
    node.pop("_id", None)

    # contact_windows are shared across all string-style links.  We serialize
    # them here once so that they are always proper ISO strings regardless of
    # whether MongoDB returned datetime objects or raw strings.
    raw_shared = node.get("contact_windows")
    shared_windows: list[dict[str, Any]] = []
    if isinstance(raw_shared, list):
        for w in raw_shared:
            serialized_w = _serialize_window(w)
            if serialized_w is not None:
                shared_windows.append(serialized_w)

    serialized_links = []
    for link in node.get("links", []):
        if isinstance(link, str):
            serialized_links.append(
                {
                    "dest_node": link,
                    "bandwidth_bps": 1000000,
                    "windows": shared_windows,
                }
            )
            continue
        if not isinstance(link, dict):
            continue

        windows = []
        for window in link.get("windows", []):
            serialized_w = _serialize_window(window)
            if serialized_w is not None:
                windows.append(serialized_w)

        serialized_links.append({
            "dest_node": link.get("dest_node") or link.get("destination"),
            "bandwidth_bps": link.get("bandwidth_bps", 1000000),
            "windows": windows,
        })

    node["links"] = serialized_links
    node["contact_windows"] = shared_windows
    return node


def _coerce_node_payload(raw_node: Any) -> dict[str, Any]:
    if not isinstance(raw_node, dict):
        raise ValueError("Each node entry must be an object.")

    node = dict(raw_node)
    raw_type = str(node.get("node_type") or "satellite").strip().lower()
    node["node_type"] = NODE_TYPE_ALIASES.get(raw_type, raw_type)

    shared_windows = node.get("contact_windows") if isinstance(node.get("contact_windows"), list) else []
    raw_links = node.get("links")
    normalized_links: list[dict[str, Any]] = []

    if isinstance(raw_links, str):
        raw_links = [item.strip() for item in raw_links.split(",") if item.strip()]

    if raw_links is None:
        raw_links = []

    if isinstance(raw_links, list):
        for link in raw_links:
            if isinstance(link, str):
                dest = link.strip()
                if not dest:
                    continue
                normalized_links.append(
                    {
                        "dest_node": dest,
                        "bandwidth_bps": 1000000,
                        "windows": shared_windows,
                    }
                )
                continue

            if not isinstance(link, dict):
                continue

            dest_node = str(
                link.get("dest_node")
                or link.get("destination")
                or link.get("target")
                or ""
            ).strip()
            bandwidth = link.get("bandwidth_bps", link.get("bandwidth", 1000000))
            windows = link.get("windows")
            if not isinstance(windows, list):
                windows = shared_windows

            normalized_links.append(
                {
                    "dest_node": dest_node,
                    "bandwidth_bps": bandwidth,
                    "windows": windows,
                }
            )

    node["links"] = normalized_links
    return node


def _format_validation_error(index: int, exc: ValidationError) -> str:
    first_error = exc.errors(include_url=False)[0] if exc.errors() else None
    if not first_error:
        return f"Node at index {index} is invalid."

    location = ".".join(str(part) for part in first_error.get("loc", [])) or "node"
    message = first_error.get("msg") or "invalid value"
    return f"Node at index {index} has invalid field '{location}': {message}."

def _normalize_nodes_payload(payload: Any) -> list[NodeConfig]:
    if isinstance(payload, dict) and "nodes" in payload:
        raw_nodes = payload["nodes"]
    elif isinstance(payload, list):
        raw_nodes = payload
    else:
        raise HTTPException(status_code=400, detail="Expected a list of nodes or a {nodes: []} object.")

    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise HTTPException(status_code=400, detail="Node payload must be a non-empty list.")

    validated_nodes: list[NodeConfig] = []
    for index, item in enumerate(raw_nodes):
        try:
            coerced = _coerce_node_payload(item)
            validated_nodes.append(NodeConfig.model_validate(coerced))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Node at index {index}: {exc}") from exc
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=_format_validation_error(index, exc)) from exc
    return validated_nodes


async def _upsert_nodes(validated_nodes: list[NodeConfig], replace: bool = False) -> dict[str, int]:
    db = get_database()
    inserted = 0
    updated = 0
    deleted = 0
    reset_packets = 0

    for node in validated_nodes:
        node_payload = node.model_dump(mode="json")
        result = await db.nodes.replace_one(
            {"node_id": node.node_id},
            node_payload,
            upsert=True,
        )

        if result.upserted_id:
            inserted += 1
        else:
            updated += 1

    if replace:
        keep_ids = [node.node_id for node in validated_nodes]
        delete_result = await db.nodes.delete_many({"node_id": {"$nin": keep_ids}})
        deleted = int(delete_result.deleted_count or 0)

        now = datetime.now(timezone.utc)
        reset_result = await db.packets.update_many(
            {
                "current_status": {
                    "$in": [
                        "WAITING_RETRY",
                        "QUEUED_ON_EARTH",
                        "IN_TRANSIT",
                    ]
                },
                "cancel_requested": {"$ne": True},
            },
            {
                "$set": {
                    "current_status": "CANCELLED",
                    "cancel_requested": True,
                    "cancel_requested_at": now,
                    "next_hop": None,
                    "route_hops": [],
                    "route_locations": {},
                    "updated_at": now,
                },
                "$push": {
                    "status_history": {
                        "status": "CANCELLED",
                        "at": now,
                        "detail": "Packet cancelled because fleet topology was replaced.",
                    }
                },
            },
        )
        reset_packets = int(reset_result.modified_count or 0)

    return {
        "inserted": inserted,
        "updated": updated,
        "deleted": deleted,
        "reset_packets": reset_packets,
    }


@router.post("")
async def upload_nodes(
    payload: NodeUploadRequest,
    replace: bool = Query(default=False),
) -> dict[str, Any]:
    stats = await _upsert_nodes(payload.nodes, replace=replace)
    return {
        "status": "ok",
        "message": "Node configuration accepted." if not replace else "Node configuration replaced.",
        **stats,
    }


@router.post("/upload-file")
async def upload_nodes_file(
    file: UploadFile = File(...),
    replace: bool = Query(default=False),
) -> dict[str, Any]:
    file_content = await file.read()
    filename = (file.filename or "").lower()

    try:
        text_content = file_content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Upload file must be UTF-8 encoded.") from exc

    try:
        if filename.endswith(".yaml") or filename.endswith(".yml"):
            parsed = yaml.safe_load(text_content)
        elif filename.endswith(".json"):
            parsed = json.loads(text_content)
        else:
            # Auto-detect fallback for unknown extension.
            try:
                parsed = json.loads(text_content)
            except json.JSONDecodeError:
                parsed = yaml.safe_load(text_content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse configuration file: {exc}") from exc

    validated_nodes = _normalize_nodes_payload(parsed)
    stats = await _upsert_nodes(validated_nodes, replace=replace)

    return {
        "status": "ok",
        "message": "Node configuration file accepted." if not replace else "Node configuration file replaced fleet.",
        **stats,
    }


@router.get("")
async def list_nodes(limit: int = 200) -> list[dict[str, Any]]:
    db = get_database()
    cursor = db.nodes.find({}).sort("node_id", 1).limit(limit)
    nodes = await cursor.to_list(length=limit)
    return [_serialize_node(node) for node in nodes]