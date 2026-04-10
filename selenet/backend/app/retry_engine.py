import asyncio
from datetime import datetime, timezone
from typing import Any

from app.cgr import CGREngine
from app.config import get_settings
from app.db import get_database
from app.models import PacketPriority
from app.rabbitmq import rabbit_publisher
from app.websocket_manager import ws_manager


def _to_rabbit_priority(priority_raw: Any) -> int:
    try:
        priority = PacketPriority(int(priority_raw))
    except Exception:
        priority = PacketPriority.BULK
    return priority.rabbit_priority


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

        nodes = await db.nodes.find({}, {"_id": 0}).to_list(length=5000)
        if not nodes:
            return

        waiting_packets = await db.packets.find(
            {"current_status": "WAITING_RETRY"},
            {
                "_id": 0,
                "packet_id": 1,
                "source_node": 1,
                "destination_node": 1,
                "priority": 1,
                "payload": 1,
                "earth_timestamp": 1,
            },
        ).sort("earth_timestamp", 1).limit(settings.retry_batch_size).to_list(length=settings.retry_batch_size)

        for packet in waiting_packets:
            next_hop = CGREngine.compute_next_hop(
                source_node=packet["source_node"],
                destination_node=packet["destination_node"],
                nodes=nodes,
                earth_timestamp=now,
            )

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
                "next_hop": next_hop,
                "earth_timestamp": str(packet["earth_timestamp"]),
                "priority": int(packet.get("priority", PacketPriority.BULK)),
                "payload": packet.get("payload", {}),
            }

            await rabbit_publisher.publish_packet(
                envelope,
                _to_rabbit_priority(packet.get("priority")),
            )

            await ws_manager.broadcast(
                {
                    "kind": "packet-status",
                    "packet_id": packet_id,
                    "status": "QUEUED_ON_EARTH",
                    "next_hop": next_hop,
                    "detail": detail,
                    "at": now.isoformat(),
                }
            )


packet_retry_engine = PacketRetryEngine()