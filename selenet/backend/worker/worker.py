import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

import aio_pika
import httpx

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
PACKET_QUEUE_PREFIX = os.getenv("PACKET_QUEUE_PREFIX", "packets")
NODE_ID = os.getenv("NODE_ID", "EARTH_GATEWAY").strip() or "EARTH_GATEWAY"
NODE_LOCATION = os.getenv("NODE_LOCATION", "").strip()
RABBITMQ_MAX_PRIORITY = int(os.getenv("RABBITMQ_MAX_PRIORITY", "10"))
BACKEND_STATUS_URL = os.getenv(
    "BACKEND_STATUS_URL",
    "http://backend:8000/api/packets/status",
)
BACKEND_PACKETS_URL = os.getenv(
    "BACKEND_PACKETS_URL",
    "http://backend:8000/api/packets",
)


def _sanitize_node_id(node_id: str | None) -> str:
    raw_value = (node_id or "").strip()
    if not raw_value:
        return NODE_ID
    sanitized = "".join(
        char if char.isalnum() or char in {"_", "-", "."} else "_"
        for char in raw_value
    )
    return sanitized or NODE_ID


def _queue_for_node(node_id: str | None) -> str:
    prefix = PACKET_QUEUE_PREFIX.strip() or "packets"
    return f"{prefix}.{_sanitize_node_id(node_id)}"


MY_QUEUE = _queue_for_node(NODE_ID)


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
    node_id: str | None = None,
    hop_index: int | None = None,
    hop_total: int | None = None,
    from_node: str | None = None,
    to_node: str | None = None,
    from_location: str | None = None,
    to_location: str | None = None,
) -> None:
    payload = {
        "packet_id": packet_id,
        "status": status,
        "next_hop": next_hop,
        "detail": detail,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    if node_id is not None:
        payload["node_id"] = node_id
    if hop_index is not None:
        payload["hop_index"] = hop_index
    if hop_total is not None:
        payload["hop_total"] = hop_total
    if from_node is not None:
        payload["from_node"] = from_node
    if to_node is not None:
        payload["to_node"] = to_node
    if from_location is not None:
        payload["from_location"] = from_location
    if to_location is not None:
        payload["to_location"] = to_location

    try:
        await client.post(BACKEND_STATUS_URL, json=payload, timeout=10.0)
    except Exception as exc:
        print(f"[worker] failed status callback for packet {packet_id}: {exc}")


async def _is_cancel_requested(client: httpx.AsyncClient, packet_id: str) -> bool:
    try:
        response = await client.get(f"{BACKEND_PACKETS_URL}/{packet_id}", timeout=10.0)
    except Exception as exc:
        print(f"[worker] failed to read packet {packet_id}: {exc}")
        return False

    if response.status_code == 404:
        return False

    if response.status_code >= 400:
        print(
            f"[worker] unexpected status while reading packet {packet_id}: "
            f"{response.status_code}"
        )
        return False

    try:
        packet_doc = response.json()
    except Exception:
        return False

    return bool(packet_doc.get("cancel_requested", False))


def _clean_route_hops(raw_value: Any) -> list[str]:
    if not isinstance(raw_value, list):
        return []

    return [
        item.strip()
        for item in raw_value
        if isinstance(item, str) and item.strip()
    ]


def _clean_route_locations(raw_value: Any) -> dict[str, str]:
    if not isinstance(raw_value, dict):
        return {}

    output: dict[str, str] = {}
    for key, value in raw_value.items():
        if not isinstance(key, str):
            continue
        if not isinstance(value, str):
            continue

        node_id = key.strip()
        location = value.strip()
        if node_id and location:
            output[node_id] = location

    return output


def _node_label(node_id: str, route_locations: dict[str, str]) -> str:
    location = route_locations.get(node_id)
    if not location:
        return node_id
    return f"{node_id} ({location})"


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _as_node_id(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


async def _ensure_queue(
    channel: aio_pika.Channel,
    queue_name: str,
    declared_queues: set[str],
) -> None:
    if queue_name in declared_queues:
        return

    await channel.declare_queue(
        queue_name,
        durable=True,
        arguments={"x-max-priority": RABBITMQ_MAX_PRIORITY},
    )
    declared_queues.add(queue_name)


async def _forward_to_next_node(
    channel: aio_pika.Channel,
    declared_queues: set[str],
    envelope: dict[str, Any],
    to_node: str,
    rabbit_priority: int | None,
) -> None:
    target_queue = _queue_for_node(to_node)
    await _ensure_queue(channel, target_queue, declared_queues)

    message = aio_pika.Message(
        body=json.dumps(envelope, default=str).encode("utf-8"),
        content_type="application/json",
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        priority=rabbit_priority,
    )

    await channel.default_exchange.publish(message, routing_key=target_queue)


async def _process_message(
    message: aio_pika.IncomingMessage,
    channel: aio_pika.Channel,
    declared_queues: set[str],
    client: httpx.AsyncClient,
) -> None:
    async with message.process(requeue=False):
        try:
            data = json.loads(message.body.decode("utf-8"))
        except json.JSONDecodeError:
            print(f"[worker:{NODE_ID}] invalid JSON payload, dropping")
            return

        packet_id = data.get("packet_id")
        current_node = _as_node_id(data.get("current_node"), NODE_ID)
        source_node = _as_node_id(data.get("source_node"), NODE_ID)

        remaining_hops = _clean_route_hops(data.get("remaining_hops"))
        if not remaining_hops:
            remaining_hops = _clean_route_hops(data.get("route_hops"))
        if not remaining_hops and isinstance(data.get("next_hop"), str) and data.get("next_hop").strip():
            remaining_hops = [data.get("next_hop").strip()]

        route_hops = _clean_route_hops(data.get("route_hops")) or remaining_hops
        route_locations = _clean_route_locations(data.get("route_locations"))

        if NODE_LOCATION and NODE_ID not in route_locations:
            route_locations[NODE_ID] = NODE_LOCATION

        if not packet_id:
            print(f"[worker:{NODE_ID}] message missing packet_id, dropping")
            return

        if not remaining_hops:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="FAILED",
                next_hop=None,
                detail="Packet has no remaining_hops and cannot be transmitted.",
                node_id=current_node,
            )
            return

        if current_node != NODE_ID:
            print(
                f"[worker:{NODE_ID}] packet {packet_id} expected node {current_node}; processing anyway"
            )

        hop_index_done = _to_int(data.get("hop_index"), default=0)
        hop_total = _to_int(data.get("hop_total"), default=0)
        if hop_total <= 0:
            hop_total = len(route_hops) if route_hops else hop_index_done + len(remaining_hops)

        to_node = remaining_hops[0]
        next_hops = remaining_hops[1:]
        hop_index = hop_index_done + 1
        from_location = route_locations.get(current_node)
        to_location = route_locations.get(to_node)

        if await _is_cancel_requested(client, packet_id):
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="CANCELLED",
                next_hop=to_node,
                detail=f"Packet cancelled at {_node_label(current_node, route_locations)} before forwarding.",
                node_id=current_node,
                hop_index=hop_index_done,
                hop_total=hop_total,
                from_node=current_node,
                to_node=to_node,
                from_location=from_location,
                to_location=to_location,
            )
            return

        detail = (
            f"Hop {hop_index}/{hop_total}: "
            f"{_node_label(current_node, route_locations)} -> {_node_label(to_node, route_locations)}."
        )

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="IN_TRANSIT",
            next_hop=to_node,
            detail=detail,
            node_id=current_node,
            hop_index=hop_index,
            hop_total=hop_total,
            from_node=current_node,
            to_node=to_node,
            from_location=from_location,
            to_location=to_location,
        )

        await asyncio.sleep(_delay_seconds(message.priority))

        if await _is_cancel_requested(client, packet_id):
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="CANCELLED",
                next_hop=to_node,
                detail=(
                    f"Transmission cancelled after hop {hop_index}/{hop_total} at "
                    f"{_node_label(to_node, route_locations)}."
                ),
                node_id=to_node,
                hop_index=hop_index,
                hop_total=hop_total,
                from_node=current_node,
                to_node=to_node,
                from_location=from_location,
                to_location=to_location,
            )
            return

        if next_hops:
            forwarded_envelope = {
                "packet_id": packet_id,
                "source_node": source_node,
                "destination_node": data.get("destination_node"),
                "current_node": to_node,
                "next_hop": next_hops[0],
                "remaining_hops": next_hops,
                "hop_index": hop_index,
                "hop_total": hop_total,
                "route_hops": route_hops,
                "route_locations": route_locations,
                "earth_timestamp": data.get("earth_timestamp"),
                "priority": data.get("priority"),
                "payload": data.get("payload", {}),
            }
            await _forward_to_next_node(
                channel=channel,
                declared_queues=declared_queues,
                envelope=forwarded_envelope,
                to_node=to_node,
                rabbit_priority=message.priority,
            )
            return

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="DELIVERED",
            next_hop=to_node,
            detail=(
                f"Transmission finished after {hop_total} hop(s) at "
                f"{_node_label(to_node, route_locations)}."
            ),
            node_id=to_node,
            hop_index=hop_index,
            hop_total=hop_total,
            from_node=current_node,
            to_node=to_node,
            from_location=from_location,
            to_location=to_location,
        )


async def _consume_forever() -> None:
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)

    declared_queues: set[str] = set()

    await _ensure_queue(channel, MY_QUEUE, declared_queues)
    queue = await channel.get_queue(MY_QUEUE)

    if NODE_LOCATION:
        print(f"[worker:{NODE_ID}] location={NODE_LOCATION}; queue={MY_QUEUE}")
    else:
        print(f"[worker:{NODE_ID}] queue={MY_QUEUE}")

    async with httpx.AsyncClient() as client:
        async def on_message(message: aio_pika.IncomingMessage) -> None:
            await _process_message(message, channel, declared_queues, client)

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