import json
from datetime import datetime, timezone
from typing import Any

import yaml
from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from ..db import get_database
from ..models import NodeConfig, NodeUploadRequest

router = APIRouter()


def _serialize_node(node: dict[str, Any]) -> dict[str, Any]:
    node.pop("_id", None)
    shared_windows = node.get("contact_windows") if isinstance(node.get("contact_windows"), list) else []
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
            if not isinstance(window, dict):
                continue
            windows.append({
                "start": window["start"].isoformat() if isinstance(window["start"], datetime) else window["start"],
                "end": window["end"].isoformat() if isinstance(window["end"], datetime) else window["end"]
            })
        serialized_links.append({
            "dest_node": link.get("dest_node"),
            "bandwidth_bps": link.get("bandwidth_bps", 1000000),
            "windows": windows
        })
    node["links"] = serialized_links
    node.pop("contact_windows", None)
    return node

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
    for item in raw_nodes:
        validated_nodes.append(NodeConfig.model_validate(item))
    return validated_nodes


async def _upsert_nodes(validated_nodes: list[NodeConfig], replace: bool = False) -> dict[str, int]:
    db = get_database()
    inserted = 0
    updated = 0
    deleted = 0
    reset_packets = 0

    for node in validated_nodes:
        node_payload = node.model_dump(mode="json")
        result = await db.nodes.update_one(
            {"node_id": node.node_id},
            {"$set": node_payload},
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