import asyncio
import json
import os
from datetime import datetime, timezone

import aio_pika
import httpx

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
PACKET_QUEUE_NAME = os.getenv("PACKET_QUEUE_NAME", "packets.priority")
RABBITMQ_MAX_PRIORITY = int(os.getenv("RABBITMQ_MAX_PRIORITY", "10"))
BACKEND_STATUS_URL = os.getenv(
    "BACKEND_STATUS_URL",
    "http://backend:8000/api/packets/status",
)


def _delay_seconds(priority: int | None) -> int:
    if priority is None:
        return 6
    if priority >= 9:
        return 2
    if priority >= 5:
        return 4
    return 7


async def _notify_backend(
    client: httpx.AsyncClient,
    packet_id: str,
    status: str,
    next_hop: str | None,
    detail: str,
    hop_index: int | None = None,
    hop_total: int | None = None,
    from_node: str | None = None,
    to_node: str | None = None,
) -> None:
    payload = {
        "packet_id": packet_id,
        "status": status,
        "next_hop": next_hop,
        "detail": detail,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    if hop_index is not None:
        payload["hop_index"] = hop_index
    if hop_total is not None:
        payload["hop_total"] = hop_total
    if from_node is not None:
        payload["from_node"] = from_node
    if to_node is not None:
        payload["to_node"] = to_node

    try:
        await client.post(BACKEND_STATUS_URL, json=payload, timeout=10.0)
    except Exception as exc:
        print(f"[worker] failed status callback for packet {packet_id}: {exc}")


async def _process_message(message: aio_pika.IncomingMessage, client: httpx.AsyncClient) -> None:
    async with message.process(requeue=False):
        data = json.loads(message.body.decode("utf-8"))
        packet_id = data.get("packet_id")
        source_node = data.get("source_node") or "EARTH_GATEWAY"
        route_hops_raw = data.get("route_hops")
        route_hops: list[str] = []

        if isinstance(route_hops_raw, list):
            route_hops = [
                item.strip()
                for item in route_hops_raw
                if isinstance(item, str) and item.strip()
            ]

        if not route_hops and isinstance(data.get("next_hop"), str) and data.get("next_hop").strip():
            route_hops = [data.get("next_hop").strip()]

        if not packet_id:
            print("[worker] message missing packet_id, dropping")
            return

        if not route_hops:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="FAILED",
                next_hop=None,
                detail="Packet has no route_hops and cannot be transmitted.",
            )
            return

        total_hops = len(route_hops)

        for hop_index, to_node in enumerate(route_hops, start=1):
            from_node = source_node if hop_index == 1 else route_hops[hop_index - 2]
            detail = f"Hop {hop_index}/{total_hops}: {from_node} -> {to_node}."

            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="IN_TRANSIT",
                next_hop=to_node,
                detail=detail,
                hop_index=hop_index,
                hop_total=total_hops,
                from_node=from_node,
                to_node=to_node,
            )

            await asyncio.sleep(_delay_seconds(message.priority))

        final_from = source_node if total_hops == 1 else route_hops[-2]
        final_to = route_hops[-1]

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="DELIVERED",
            next_hop=final_to,
            detail=f"Transmission simulation finished successfully across {total_hops} hop(s).",
            hop_index=total_hops,
            hop_total=total_hops,
            from_node=final_from,
            to_node=final_to,
        )


async def _consume_forever() -> None:
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)

    queue = await channel.declare_queue(
        PACKET_QUEUE_NAME,
        durable=True,
        arguments={"x-max-priority": RABBITMQ_MAX_PRIORITY},
    )

    print(f"[worker] consuming queue: {PACKET_QUEUE_NAME}")

    async with httpx.AsyncClient() as client:
        async def on_message(message: aio_pika.IncomingMessage) -> None:
            await _process_message(message, client)

        await queue.consume(on_message)
        await asyncio.Future()


async def main() -> None:
    while True:
        try:
            await _consume_forever()
        except Exception as exc:
            print(f"[worker] runtime error: {exc}; reconnecting in 5s")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())