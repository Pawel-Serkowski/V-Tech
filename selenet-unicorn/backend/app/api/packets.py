import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..cgr import CGREngine
from ..db import get_database
from ..models import PacketAck, PacketCreate, PacketStatusUpdate, PacketSummary, QueueLoadItem
from ..rabbitmq import packet_queue_name_for_node, rabbit_publisher
from ..simulation_time import get_time_acceleration, now_utc, resolve_simulation_now
from ..websocket_manager import ws_manager
from ..utils2 import flatten_nodes_to_contact_plan, estimate_packet_size

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

    return None


def _build_route_locations(
    source_node: str,
    route_hops: list[str],
    nodes: list[dict[str, Any]],
) -> dict[str, str]:
    node_map = {
        item.get("node_id"): item
        for item in nodes
        if isinstance(item.get("node_id"), str)
    }

    route_locations: dict[str, str] = {}
    ordered_node_ids = [source_node, *route_hops]

    for node_id in ordered_node_ids:
        node_doc = node_map.get(node_id)
        if not node_doc:
            continue

        location = _extract_node_location(node_doc)
        if location:
            route_locations[node_id] = location

    return route_locations


def _extract_link_destinations(node: dict[str, Any]) -> list[str]:
    links_raw = node.get("links")
    if not isinstance(links_raw, list):
        return []

    unique: set[str] = set()
    output: list[str] = []
    for link in links_raw:
        if not isinstance(link, dict):
            continue
        dest = link.get("dest_node")
        if not isinstance(dest, str):
            continue
        cleaned = dest.strip()
        if not cleaned or cleaned in unique:
            continue
        unique.add(cleaned)
        output.append(cleaned)

    return output


@router.post("", response_model=PacketAck, status_code=202)
async def ingest_packet(packet: PacketCreate) -> PacketAck:
    db = get_database()
    real_now = now_utc()
    
    nodes_raw = await db.nodes.find({}, {"_id": 0}).to_list(length=5000)
    
    contact_plan = flatten_nodes_to_contact_plan(nodes_raw)
    earth_timestamp = resolve_simulation_now(contact_plan=contact_plan, real_now=real_now)
    simulation_acceleration = get_time_acceleration()
    
    packet_size = estimate_packet_size(packet.payload)

    route_hops = CGREngine.compute_route_hops(
        source_node=packet.source_node,
        destination_node=packet.destination_node,
        contact_plan=contact_plan,
        earth_timestamp=earth_timestamp,
        packet_size_bytes=packet_size, 
        ttl_seconds=packet.ttl_seconds,
        hop_limit=packet.hop_limit,
        nodes=nodes_raw,
    )
    next_hop = route_hops[0] if route_hops else None
    route_locations = _build_route_locations(packet.source_node, route_hops or [], nodes_raw)

    queue_status = "QUEUED_ON_EARTH" if next_hop else "WAITING_RETRY"
    queue_detail = (
        "Packet persisted and evaluated by CGR."
        if next_hop
        else "No valid route currently available (LOS/cone constraints or missing satellite relay path)."
    )

    status_history = [
        {
            "status": "SAVED_ON_EARTH",
            "at": earth_timestamp,
            "detail": "ACK sent to command center dashboard.",
        },
        {
            "status": queue_status,
            "at": earth_timestamp,
            "detail": queue_detail,
            "next_hop": next_hop,
        },
    ]

    packet_id = str(uuid.uuid4())

    packet_doc = {
        "packet_id": packet_id,
        "source_node": packet.source_node,
        "destination_node": packet.destination_node,
        "priority": int(packet.priority),
        "payload": packet.payload,
        "earth_timestamp": earth_timestamp,
        "simulation_real_anchor": real_now,
        "simulation_acceleration": simulation_acceleration,
        "ttl_seconds":  packet.ttl_seconds,
        "hop_limit": packet.hop_limit,
        "expire_at": earth_timestamp + timedelta(seconds=packet.ttl_seconds),
        "hops_traveled": 0,
        "cancel_requested": False,
        "cancel_requested_at": None,
        "next_hop": next_hop,
        "route_hops": route_hops or [],
        "route_locations": route_locations,
        "current_status": queue_status,
        "status_history": status_history,
    }
    await db.packets.insert_one(packet_doc)

    if next_hop:
        envelope = {
            "packet_id": packet_id,
            "source_node": packet.source_node,
            "destination_node": packet.destination_node,
            "current_node": packet.source_node,
            "next_hop": next_hop,
            "remaining_hops": route_hops,
            "hop_index": 0,
            "hop_total": len(route_hops),
            "route_hops": route_hops,
            "route_locations": route_locations,
            "earth_timestamp": earth_timestamp.isoformat(),
            "simulation_real_anchor": real_now.isoformat(),
            "simulation_acceleration": simulation_acceleration,
            "ttl_seconds": packet.ttl_seconds,
            "hop_limit": packet.hop_limit,
            "expire_at": (earth_timestamp + timedelta(seconds=packet.ttl_seconds)).isoformat(),
            "priority": int(packet.priority),
            "payload": packet.payload,
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


@router.get("/dispatch-context")
async def dispatch_context() -> dict[str, Any]:
    db = get_database()
    nodes = await db.nodes.find({}, {"_id": 0, "node_id": 1, "links": 1}).to_list(length=5000)

    node_ids = sorted(
        {
            item.get("node_id")
            for item in nodes
            if isinstance(item.get("node_id"), str) and item.get("node_id").strip()
        }
    )

    if len(node_ids) < 2:
        return {
            "allowed_source_nodes": node_ids,
            "summary": "Zdefiniuj co najmniej 2 wezly, aby uruchomic dispatch.",
            "configuration_error": "Need at least two nodes in configuration.",
        }

    nodes_with_links = []
    for node in nodes:
        node_id = node.get("node_id")
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        if _extract_link_destinations(node):
            nodes_with_links.append(node_id)

    allowed = sorted(set(nodes_with_links or node_ids))
    return {
        "allowed_source_nodes": allowed,
        "summary": "Wybierz wezel zrodlowy i docelowy z aktualnej topologii.",
        "configuration_error": "",
    }


@router.get("/queue-load", response_model=list[QueueLoadItem])
async def queue_load() -> list[QueueLoadItem]:
    db = get_database()

    pipeline = [
        {
            "$match": {
                "cancel_requested": {"$ne": True},
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

    packet_row = await db.packets.find_one(
        {"packet_id": update.packet_id},
        {"_id": 0, "current_status": 1},
    )
    if packet_row is None:
        raise HTTPException(status_code=404, detail="Packet not found.")

    if packet_row.get("current_status") == "CANCELLED":
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
    if update.hop_index is not None:
        set_payload["current_hop_index"] = update.hop_index
    if update.hop_total is not None:
        set_payload["hop_total"] = update.hop_total
    if update.node_id is not None:
        set_payload["current_node_id"] = update.node_id
    if update.time_elapsed is not None:
        set_payload["time_elapsed"] = update.time_elapsed
    if update.ttl_remaining is not None:
        set_payload["ttl_remaining"] = update.ttl_remaining
    if update.from_node is not None:
        set_payload["from_node"] = update.from_node
    if update.to_node is not None:
        set_payload["to_node"] = update.to_node

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
            "at": update.at.isoformat(),
        }
    )

    return {"accepted": True}


@router.post("/{packet_id}/cancel")
async def cancel_packet(packet_id: str):
    db = get_database()
    cancelled_at = now_utc()

    packet_row = await db.packets.find_one(
        {"packet_id": packet_id},
        {"_id": 0, "current_status": 1, "cancel_requested": 1},
    )

    if packet_row is None:
        raise HTTPException(status_code=404, detail="Packet not found.")

    current_status = str(packet_row.get("current_status", "")).upper()
    if current_status in {"DELIVERED", "FAILED", "FAILED_EXPIRED", "ERROR"}:
        raise HTTPException(
            status_code=409,
            detail=f"Packet is already terminal ({current_status}) and cannot be cancelled.",
        )

    if current_status == "CANCELLED":
        return {
            "status": "Packet already cancelled",
            "packet_id": packet_id,
        }

    # Old records may have cancel_requested=true but still non-terminal state;
    # finalize cancellation idempotently in this case.
    if bool(packet_row.get("cancel_requested", False)):
        await db.packets.update_one(
            {"packet_id": packet_id},
            {
                "$set": {
                    "current_status": "CANCELLED",
                    "updated_at": cancelled_at,
                },
                "$push": {
                    "status_history": {
                        "status": "CANCELLED",
                        "at": cancelled_at,
                        "detail": "Cancellation finalized by API.",
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
        return {
            "status": "Packet already had cancel request and is now cancelled",
            "packet_id": packet_id,
        }

    result = await db.packets.update_one(
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

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Packet not found.")

    await ws_manager.broadcast(
        {
            "kind": "packet-status",
            "packet_id": packet_id,
            "status": "CANCEL_REQUESTED",
            "detail": "Cancellation requested by operator.",
            "at": cancelled_at.isoformat(),
        }
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
    return {
        "status": "Cancellation request received and packet cancelled",
        "packet_id": packet_id,
    }


@router.get("/{packet_id}", response_model=PacketSummary)
async def get_packet(packet_id: str) -> PacketSummary:
    db = get_database()
    row = await db.packets.find_one({"packet_id": packet_id})
    if row is None:
        raise HTTPException(status_code=404, detail="Packet not found.")

    return PacketSummary.model_validate(_serialize_packet(row))


@router.delete("", status_code=204)
async def clear_all_packets():
    db = get_database()
    await db.packets.delete_many({})
    
    await ws_manager.broadcast({
        "kind": "packets-cleared",
        "at": now_utc().isoformat()
    })
    return None
