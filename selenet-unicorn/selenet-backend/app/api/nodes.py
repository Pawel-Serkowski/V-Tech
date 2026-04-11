import json
from datetime import datetime
from typing import Any

import yaml
from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.db import get_database
from app.models import NodeConfig, NodeUploadRequest

router = APIRouter()


def _serialize_node(node: dict[str, Any]) -> dict[str, Any]:
    node.pop("_id", None)
    windows: list[dict[str, Any]] = []
    for window in node.get("contact_windows", []):
        start = window.get("start")
        end = window.get("end")
        windows.append(
            {
                "start": start.isoformat() if isinstance(start, datetime) else start,
                "end": end.isoformat() if isinstance(end, datetime) else end,
            }
        )
    node["contact_windows"] = windows
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

    return [NodeConfig.model_validate(item) for item in raw_nodes]


async def _upsert_nodes(validated_nodes: list[NodeConfig]) -> dict[str, int]:
    db = get_database()
    inserted = 0
    updated = 0

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

    return {"inserted": inserted, "updated": updated}


@router.post("")
async def upload_nodes(payload: NodeUploadRequest, replace: bool = Query(default=False)) -> dict[str, Any]:
    db = get_database()

    if replace:
        payload_node_ids = [node.node_id for node in payload.nodes]
        await db.nodes.delete_many({"node_id": {"$nin": payload_node_ids}})

    stats = await _upsert_nodes(payload.nodes)
    return {
        "status": "ok",
        "message": "Node configuration accepted.",
        "replace": replace,
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
            try:
                parsed = json.loads(text_content)
            except json.JSONDecodeError:
                parsed = yaml.safe_load(text_content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse configuration file: {exc}") from exc

    validated_nodes = _normalize_nodes_payload(parsed)

    db = get_database()
    if replace:
        payload_node_ids = [node.node_id for node in validated_nodes]
        await db.nodes.delete_many({"node_id": {"$nin": payload_node_ids}})

    stats = await _upsert_nodes(validated_nodes)

    return {
        "status": "ok",
        "message": "Node configuration file accepted.",
        "replace": replace,
        **stats,
    }


@router.get("")
async def list_nodes(limit: int = 500) -> list[dict[str, Any]]:
    db = get_database()
    cursor = db.nodes.find({}).sort("node_id", 1).limit(limit)
    nodes = await cursor.to_list(length=limit)
    return [_serialize_node(node) for node in nodes]
