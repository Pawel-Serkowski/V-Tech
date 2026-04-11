import asyncio
from datetime import datetime, timezone
from typing import Any

from .cgr import CGREngine
from .config import get_settings
from .db import get_database
from .models import PacketPriority
from .rabbitmq import packet_queue_name_for_node, rabbit_publisher
from .utils2 import estimate_packet_size, flatten_nodes_to_contact_plan
from .websocket_manager import ws_manager


def _to_rabbit_priority(priority_raw: Any) -> int:
    try:
        priority = PacketPriority(int(priority_raw))
    except Exception:
        priority = PacketPriority.BULK
    return priority.rabbit_priority


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


def _as_utc(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class PacketRetryEngine:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="packet-retry-engine")

    async def stop(self) -> None:
        self._stop_event.set()

        if self._task is None:
            return

        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

    async def _run(self) -> None:
        settings = get_settings()

        while not self._stop_event.is_set():
            try:
                await self._retry_waiting_packets()
            except Exception as exc:  # pragma: no cover - resilience path
                print(f"[retry-engine] cycle error: {exc}")

            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=settings.retry_scan_interval_seconds,
                )
            except TimeoutError:
                continue

    async def _retry_waiting_packets(self) -> None:
        settings = get_settings()
        db = get_database()
        now = datetime.now(timezone.utc)

        # Expire stale WAITING_RETRY packets before attempting re-routing.
        await db.packets.update_many(
            {
                "current_status": "WAITING_RETRY",
                "expire_at": {"$lte": now},
            },
            {
                "$set": {
                    "current_status": "FAILED_EXPIRED",
                    "updated_at": now,
                },
                "$push": {
                    "status_history": {
                        "status": "FAILED_EXPIRED",
                        "at": now,
                        "detail": "Packet expired before a valid contact window opened.",
                    }
                },
            },
        )

        nodes = await db.nodes.find({}, {"_id": 0}).to_list(length=5000)
        if not nodes:
            return
        contact_plan = flatten_nodes_to_contact_plan(nodes)

        waiting_packets = await db.packets.find(
            {
                "current_status": "WAITING_RETRY",
                "$or": [
                    {"expire_at": {"$gt": now}},
                    {"expire_at": {"$exists": False}},
                    {"expire_at": None},
                ],
            },
            {
                "_id": 0,
                "packet_id": 1,
                "source_node": 1,
                "destination_node": 1,
                "priority": 1,
                "payload": 1,
                "earth_timestamp": 1,
                "ttl_seconds": 1,
                "hop_limit": 1,
                "expire_at": 1,
            },
        ).sort("earth_timestamp", 1).limit(settings.retry_batch_size).to_list(length=settings.retry_batch_size)

        for packet in waiting_packets:
            expire_at = _as_utc(packet.get("expire_at"))
            if isinstance(expire_at, datetime) and now > expire_at:
                detail = "Packet expired before a valid contact window opened."
                await db.packets.update_one(
                    {"packet_id": packet["packet_id"], "current_status": "WAITING_RETRY"},
                    {
                        "$set": {
                            "current_status": "FAILED_EXPIRED",
                            "updated_at": now,
                        },
                        "$push": {
                            "status_history": {
                                "status": "FAILED_EXPIRED",
                                "at": now,
                                "detail": detail,
                            }
                        },
                    },
                )
                await ws_manager.broadcast(
                    {
                        "kind": "packet-status",
                        "packet_id": packet["packet_id"],
                        "status": "FAILED_EXPIRED",
                        "detail": detail,
                        "at": now.isoformat(),
                    }
                )
                continue

            remaining_ttl_seconds = packet.get("ttl_seconds", 3600)
            if isinstance(expire_at, datetime):
                remaining_ttl_seconds = max(1, int((expire_at - now).total_seconds()))

            packet_size_bytes = estimate_packet_size(packet.get("payload", {}))

            route_hops = CGREngine.compute_route_hops(
                source_node=packet["source_node"],
                destination_node=packet["destination_node"],
                contact_plan=contact_plan,
                earth_timestamp=now,
                packet_size_bytes=packet_size_bytes,
                ttl_seconds=remaining_ttl_seconds,
                hop_limit=packet.get("hop_limit", 10),
                nodes=nodes,
            )
            next_hop = route_hops[0] if route_hops else None
            route_locations = _build_route_locations(packet["source_node"], route_hops or [], nodes)

            if not next_hop:
                continue

            packet_id = packet["packet_id"]
            detail = "Retry engine detected an open contact window and re-queued packet."

            update_result = await db.packets.update_one(
                {
                    "packet_id": packet_id,
                    "current_status": "WAITING_RETRY",
                },
                {
                    "$set": {
                        "current_status": "QUEUED_ON_EARTH",
                        "next_hop": next_hop,
                        "route_hops": route_hops,
                        "route_locations": route_locations,
                        "updated_at": now,
                    },
                    "$push": {
                        "status_history": {
                            "status": "QUEUED_ON_EARTH",
                            "at": now,
                            "detail": detail,
                            "next_hop": next_hop,
                        }
                    },
                },
            )

            if update_result.modified_count == 0:
                continue

            envelope = {
                "packet_id": packet_id,
                "source_node": packet["source_node"],
                "destination_node": packet["destination_node"],
                "current_node": packet["source_node"],
                "next_hop": next_hop,
                "remaining_hops": route_hops,
                "hop_index": 0,
                "hop_total": len(route_hops),
                "route_hops": route_hops,
                "route_locations": route_locations,
                "earth_timestamp": str(packet["earth_timestamp"]),
                "ttl_seconds": int(remaining_ttl_seconds),
                "hop_limit": int(packet.get("hop_limit", 10)),
                "expire_at": expire_at.isoformat() if isinstance(expire_at, datetime) else None,
                "priority": int(packet.get("priority", PacketPriority.BULK)),
                "payload": packet.get("payload", {}),
            }

            await rabbit_publisher.publish_packet(
                envelope,
                _to_rabbit_priority(packet.get("priority")),
                queue_name=packet_queue_name_for_node(packet["source_node"]),
            )

            await ws_manager.broadcast(
                {
                    "kind": "packet-status",
                    "packet_id": packet_id,
                    "status": "QUEUED_ON_EARTH",
                    "next_hop": next_hop,
                    "route_hops": route_hops,
                    "route_locations": route_locations,
                    "detail": detail,
                    "at": now.isoformat(),
                }
            )


packet_retry_engine = PacketRetryEngine()