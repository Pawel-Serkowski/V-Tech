import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.cgr import CGREngine
from app.config import get_settings
from app.db import get_database
from app.models import (
    DispatchContext,
    PacketAck,
    PacketCreate,
    PacketStatusUpdate,
    PacketSummary,
    QueueLoadItem,
)
from app.rabbitmq import packet_queue_name_for_node, rabbit_publisher
from app.services.dispatch_policy import resolve_allowed_source_nodes, validate_source_allowed
from app.websocket_manager import ws_manager

router = APIRouter()


def _serialize_packet(document: dict[str, Any]) -> dict[str, Any]:
    document.pop("_id", None)
    return document


def _extract_node_location(node: dict[str, Any]) -> str | None:
    location_label = node.get("location_label")
    if isinstance(location_label, str) and location_label.strip():
        return location_label.strip()

    orbit = node.get("orbit")
    if isinstance(orbit, str) and orbit.strip():
        return orbit.strip()

    body = node.get("body")
    if isinstance(body, str) and body.strip():
        return body.strip()

    return None


def _build_route_locations(route_nodes: list[str], nodes: list[dict[str, Any]]) -> dict[str, str]:
    node_map = {
        item.get("node_id"): item
        for item in nodes
        if isinstance(item.get("node_id"), str)
    }

    route_locations: dict[str, str] = {}
    for node_id in route_nodes:
        node_doc = node_map.get(node_id)
        if not node_doc:
            continue

        location = _extract_node_location(node_doc)
        if location:
            route_locations[node_id] = location

    return route_locations


@router.get("/dispatch-context", response_model=DispatchContext)
async def dispatch_context() -> DispatchContext:
    db = get_database()
    settings = get_settings()

    nodes = await db.nodes.find({}, {"_id": 0}).to_list(length=5000)
    allowed_sources = resolve_allowed_source_nodes(nodes, settings)

    return DispatchContext(
        service_location=settings.service_location,
        dispatch_origin_scope=settings.dispatch_origin_scope,
        allowed_source_nodes=allowed_sources,
    )


@router.post("", response_model=PacketAck, status_code=202)
async def ingest_packet(packet: PacketCreate) -> PacketAck:
    db = get_database()
    settings = get_settings()

    earth_timestamp = datetime.now(timezone.utc)
    packet_id = str(uuid.uuid4())

    nodes = await db.nodes.find({}, {"_id": 0}).to_list(length=5000)
    node_ids = {
        node.get("node_id")
        for node in nodes
        if isinstance(node.get("node_id"), str)
    }

    if packet.source_node not in node_ids:
        raise HTTPException(status_code=404, detail=f"Unknown source node: {packet.source_node}")
    if packet.destination_node not in node_ids:
        raise HTTPException(status_code=404, detail=f"Unknown destination node: {packet.destination_node}")

    allowed_sources = resolve_allowed_source_nodes(nodes, settings)
    if not validate_source_allowed(packet.source_node, allowed_sources):
        raise HTTPException(
            status_code=403,
            detail={
                "message": "Source node is not allowed by dispatch policy.",
                "source_node": packet.source_node,
                "dispatch_origin_scope": settings.dispatch_origin_scope,
                "allowed_source_nodes": allowed_sources,
            },
        )

    route_hops = CGREngine.compute_route_hops(
        source_node=packet.source_node,
        destination_node=packet.destination_node,
        nodes=nodes,
        earth_timestamp=earth_timestamp,
        ttl_seconds=packet.ttl_seconds,
        hop_limit=packet.hop_limit,
    )

    next_hop = route_hops[0] if route_hops else None
    route_nodes = [packet.source_node, *(route_hops or [])]
    route_locations = _build_route_locations(route_nodes, nodes)

    queue_status = "QUEUED_ON_SOURCE" if next_hop else "QUEUED_WAITING_ROUTE"

    status_history = [
        {
            "status": "SAVED_ON_EARTH",
            "at": earth_timestamp,
            "detail": "ACK sent to command center dashboard.",
        },
        {
            "status": queue_status,
            "at": earth_timestamp,
            "detail": "Packet persisted and queued for worker-side CGR.",
            "next_hop": next_hop,
        },
    ]

    packet_doc = {
        "packet_id": packet_id,
        "source_node": packet.source_node,
        "destination_node": packet.destination_node,
        "priority": int(packet.priority),
        "payload": packet.payload,
        "earth_timestamp": earth_timestamp,
        "ttl_seconds": packet.ttl_seconds,
        "hop_limit": packet.hop_limit,
        "expire_at": earth_timestamp + timedelta(seconds=packet.ttl_seconds),
        "cancel_requested": False,
        "cancel_requested_at": None,
        "current_node_id": packet.source_node,
        "next_hop": next_hop,
        "route_hops": route_hops or [],
        "route_locations": route_locations,
        "current_status": queue_status,
        "status_history": status_history,
    }
    await db.packets.insert_one(packet_doc)

    envelope = {
        "packet_id": packet_id,
        "source_node": packet.source_node,
        "destination_node": packet.destination_node,
        "current_node": packet.source_node,
        "hop_index": 0,
        "hop_limit": packet.hop_limit,
        "earth_timestamp": earth_timestamp.isoformat(),
        "ttl_seconds": packet.ttl_seconds,
        "priority": int(packet.priority),
        "payload": packet.payload,
        "route_preview": route_hops or [],
        "route_locations": route_locations,
    }

    await rabbit_publisher.publish_packet(
        envelope,
        packet.priority.rabbit_priority,
        queue_name=packet_queue_name_for_node(packet.source_node),
    )

    await ws_manager.broadcast(
        {
            "kind": "packet-status",
            "packet_id": packet_id,
            "status": queue_status,
            "next_hop": next_hop,
            "route_hops": route_hops,
            "route_locations": route_locations,
            "at": earth_timestamp.isoformat(),
        }
    )

    return PacketAck(
        packet_id=packet_id,
        status="SAVED_ON_EARTH",
        earth_timestamp=earth_timestamp,
        next_hop=next_hop,
        route_hops=route_hops or [],
    )


@router.get("", response_model=list[PacketSummary])
async def list_packets(limit: int = Query(default=100, ge=1, le=1000)) -> list[PacketSummary]:
    db = get_database()
    cursor = db.packets.find({}).sort("earth_timestamp", -1).limit(limit)
    rows = await cursor.to_list(length=limit)
    return [PacketSummary.model_validate(_serialize_packet(row)) for row in rows]


@router.get("/queue-load", response_model=list[QueueLoadItem])
async def queue_load() -> list[QueueLoadItem]:
    db = get_database()

    pipeline = [
        {
            "$match": {
                "cancel_requested": {"$ne": True},
                "current_status": {
                    "$in": [
                        "QUEUED_ON_SOURCE",
                        "QUEUED_WAITING_ROUTE",
                        "WAITING_RETRY",
                        "IN_TRANSIT",
                    ]
                },
            }
        },
        {
            "$group": {
                "_id": {"$ifNull": ["$current_node_id", "UNASSIGNED"]},
                "queued_packets": {"$sum": 1},
            }
        },
        {"$sort": {"queued_packets": -1}},
    ]

    records = await db.packets.aggregate(pipeline).to_list(length=200)
    return [
        QueueLoadItem(node_id=item["_id"], queued_packets=item["queued_packets"])
        for item in records
    ]


@router.get("/{packet_id}", response_model=PacketSummary)
async def get_packet(packet_id: str) -> PacketSummary:
    db = get_database()
    row = await db.packets.find_one({"packet_id": packet_id})
    if row is None:
        raise HTTPException(status_code=404, detail="Packet not found.")

    return PacketSummary.model_validate(_serialize_packet(row))


@router.post("/status", status_code=202)
async def register_status_update(update: PacketStatusUpdate) -> dict[str, Any]:
    db = get_database()

    packet_row = await db.packets.find_one(
        {"packet_id": update.packet_id},
        {"_id": 0, "current_status": 1},
    )
    if packet_row is None:
        raise HTTPException(status_code=404, detail="Packet not found.")

    if packet_row.get("current_status") == "CANCELLED" and update.status != "CANCELLED":
        return {
            "accepted": False,
            "ignored": "packet-cancelled",
        }

    set_payload: dict[str, Any] = {
        "current_status": update.status,
        "updated_at": update.at,
    }
    if update.status == "CANCELLED":
        set_payload["cancel_requested"] = True
        set_payload["cancel_requested_at"] = update.at
    if update.next_hop is not None:
        set_payload["next_hop"] = update.next_hop
    if update.to_node is not None:
        set_payload["next_hop"] = update.to_node
        set_payload["current_node_id"] = update.to_node
    if update.node_id is not None:
        set_payload["current_node_id"] = update.node_id

    history_row = {
        "status": update.status,
        "at": update.at,
        "detail": update.detail,
        "node_id": update.node_id,
        "next_hop": update.next_hop,
        "hop_index": update.hop_index,
        "hop_total": update.hop_total,
        "from_node": update.from_node,
        "to_node": update.to_node,
        "from_location": update.from_location,
        "to_location": update.to_location,
        "time_elapsed": update.time_elapsed,
        "ttl_remaining": update.ttl_remaining,
        "hop_delay_seconds": update.hop_delay_seconds,
    }

    result = await db.packets.update_one(
        {"packet_id": update.packet_id},
        {
            "$set": set_payload,
            "$push": {"status_history": history_row},
        },
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Packet not found.")

    await ws_manager.broadcast(
        {
            "kind": "packet-status",
            "packet_id": update.packet_id,
            "status": update.status,
            "node_id": update.node_id,
            "next_hop": update.next_hop or update.to_node,
            "detail": update.detail,
            "hop_index": update.hop_index,
            "hop_total": update.hop_total,
            "from_node": update.from_node,
            "to_node": update.to_node,
            "from_location": update.from_location,
            "to_location": update.to_location,
            "time_elapsed": update.time_elapsed,
            "ttl_remaining": update.ttl_remaining,
            "hop_delay_seconds": update.hop_delay_seconds,
            "at": update.at.isoformat(),
        }
    )

    return {"accepted": True}


@router.post("/{packet_id}/cancel")
async def cancel_packet(packet_id: str) -> dict[str, str]:
    db = get_database()
    cancelled_at = datetime.now(timezone.utc)

    packet_row = await db.packets.find_one(
        {"packet_id": packet_id},
        {"_id": 0, "current_status": 1},
    )
    if packet_row is None:
        raise HTTPException(status_code=404, detail="Packet not found.")

    current_status = str(packet_row.get("current_status", "")).upper()
    if current_status in {"DELIVERED", "FAILED", "FAILED_EXPIRED", "CANCELLED"}:
        return {"status": f"Packet already terminal ({current_status})", "packet_id": packet_id}

    await db.packets.update_one(
        {"packet_id": packet_id},
        {
            "$set": {
                "cancel_requested": True,
                "cancel_requested_at": cancelled_at,
                "current_status": "CANCELLED",
                "updated_at": cancelled_at,
            },
            "$push": {
                "status_history": {
                    "$each": [
                        {
                            "status": "CANCEL_REQUESTED",
                            "at": cancelled_at,
                            "detail": "Cancellation requested by operator.",
                        },
                        {
                            "status": "CANCELLED",
                            "at": cancelled_at,
                            "detail": "Cancellation finalized by API.",
                        },
                    ]
                }
            },
        },
    )

    await ws_manager.broadcast(
        {
            "kind": "packet-status",
            "packet_id": packet_id,
            "status": "CANCELLED",
            "detail": "Cancellation finalized by API.",
            "at": cancelled_at.isoformat(),
        }
    )

    return {"status": "Cancellation request received", "packet_id": packet_id}
