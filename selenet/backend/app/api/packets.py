import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.cgr import CGREngine
from app.db import get_database
from app.models import PacketAck, PacketCreate, PacketStatusUpdate, PacketSummary, QueueLoadItem
from app.rabbitmq import rabbit_publisher
from app.websocket_manager import ws_manager

router = APIRouter()


def _serialize_packet(document: dict[str, Any]) -> dict[str, Any]:
    document.pop("_id", None)
    return document


@router.post("", response_model=PacketAck, status_code=202)
async def ingest_packet(packet: PacketCreate) -> PacketAck:
    db = get_database()
    packet_id = str(uuid.uuid4())
    earth_timestamp = datetime.now(timezone.utc)

    nodes = await db.nodes.find({}, {"_id": 0}).to_list(length=5000)
    next_hop = CGREngine.compute_next_hop(
        source_node=packet.source_node,
        destination_node=packet.destination_node,
        nodes=nodes,
        earth_timestamp=earth_timestamp,
    )

    queue_status = "QUEUED_ON_EARTH" if next_hop else "WAITING_RETRY"

    status_history = [
        {
            "status": "SAVED_ON_EARTH",
            "at": earth_timestamp,
            "detail": "ACK sent to command center dashboard.",
        },
        {
            "status": queue_status,
            "at": earth_timestamp,
            "detail": "Packet persisted and evaluated by CGR.",
        },
    ]

    packet_doc = {
        "packet_id": packet_id,
        "source_node": packet.source_node,
        "destination_node": packet.destination_node,
        "priority": int(packet.priority),
        "payload": packet.payload,
        "earth_timestamp": earth_timestamp,
        "next_hop": next_hop,
        "current_status": queue_status,
        "status_history": status_history,
    }
    await db.packets.insert_one(packet_doc)

    if next_hop:
        envelope = {
            "packet_id": packet_id,
            "source_node": packet.source_node,
            "destination_node": packet.destination_node,
            "next_hop": next_hop,
            "earth_timestamp": earth_timestamp.isoformat(),
            "priority": int(packet.priority),
            "payload": packet.payload,
        }
        await rabbit_publisher.publish_packet(envelope, packet.priority.rabbit_priority)

    await ws_manager.broadcast(
        {
            "kind": "packet-status",
            "packet_id": packet_id,
            "status": queue_status,
            "next_hop": next_hop,
            "at": earth_timestamp.isoformat(),
        }
    )

    return PacketAck(
        packet_id=packet_id,
        status="SAVED_ON_EARTH",
        earth_timestamp=earth_timestamp,
        next_hop=next_hop,
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
                "current_status": {
                    "$in": [
                        "QUEUED_ON_EARTH",
                        "WAITING_RETRY",
                        "IN_TRANSIT",
                    ]
                }
            }
        },
        {
            "$group": {
                "_id": {"$ifNull": ["$next_hop", "UNASSIGNED"]},
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


@router.post("/status", status_code=202)
async def register_status_update(update: PacketStatusUpdate) -> dict[str, Any]:
    db = get_database()

    set_payload: dict[str, Any] = {
        "current_status": update.status,
        "updated_at": update.at,
    }
    if update.next_hop is not None:
        set_payload["next_hop"] = update.next_hop

    history_row = {
        "status": update.status,
        "at": update.at,
        "detail": update.detail,
        "next_hop": update.next_hop,
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
            "next_hop": update.next_hop,
            "detail": update.detail,
            "at": update.at.isoformat(),
        }
    )

    return {"accepted": True}