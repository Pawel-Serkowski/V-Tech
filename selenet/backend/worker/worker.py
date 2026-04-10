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
) -> None:
    payload = {
        "packet_id": packet_id,
        "status": status,
        "next_hop": next_hop,
        "detail": detail,
        "at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        await client.post(BACKEND_STATUS_URL, json=payload, timeout=10.0)
    except Exception as exc:
        print(f"[worker] failed status callback for packet {packet_id}: {exc}")


async def _process_message(message: aio_pika.IncomingMessage, client: httpx.AsyncClient) -> None:
    async with message.process(requeue=False):
        data = json.loads(message.body.decode("utf-8"))
        packet_id = data.get("packet_id")
        next_hop = data.get("next_hop")

        if not packet_id:
            print("[worker] message missing packet_id, dropping")
            return

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="IN_TRANSIT",
            next_hop=next_hop,
            detail=f"Packet forwarded to {next_hop or 'unknown hop'}.",
        )

        await asyncio.sleep(_delay_seconds(message.priority))

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="DELIVERED",
            next_hop=next_hop,
            detail="Transmission simulation finished successfully.",
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