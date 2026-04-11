import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

import aio_pika
import httpx

from app.cgr import compute_hop_delay_seconds
from app.models import PacketPriority
from app.services.worker_routing import compute_ttl_remaining_seconds, pick_next_hop

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
PACKET_QUEUE_PREFIX = os.getenv("PACKET_QUEUE_PREFIX", "packets")
NODE_ID = os.getenv("NODE_ID", "EARTH_GATEWAY").strip() or "EARTH_GATEWAY"
NODE_LOCATION = os.getenv("NODE_LOCATION", "").strip()
RABBITMQ_MAX_PRIORITY = int(os.getenv("RABBITMQ_MAX_PRIORITY", "10"))
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://backend:8000").rstrip("/")
RETRY_REQUEUE_SECONDS = float(os.getenv("RETRY_REQUEUE_SECONDS", "2"))
SIMULATION_TIME_SCALE = max(0.01, float(os.getenv("SIMULATION_TIME_SCALE", "1.0")))

BACKEND_STATUS_URL = f"{BACKEND_BASE_URL}/api/packets/status"
BACKEND_PACKET_URL = f"{BACKEND_BASE_URL}/api/packets"
BACKEND_NODES_URL = f"{BACKEND_BASE_URL}/api/nodes"


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


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _as_node_id(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _extract_route_locations(nodes: list[dict[str, Any]]) -> dict[str, str]:
    route_locations: dict[str, str] = {}

    for node in nodes:
        node_id = node.get("node_id")
        if not isinstance(node_id, str):
            continue

        location_label = node.get("location_label")
        if isinstance(location_label, str) and location_label.strip():
            route_locations[node_id] = location_label.strip()
            continue

        orbit = node.get("orbit")
        if isinstance(orbit, str) and orbit.strip():
            route_locations[node_id] = orbit.strip()
            continue

        body = node.get("body")
        if isinstance(body, str) and body.strip():
            route_locations[node_id] = body.strip()

    if NODE_LOCATION and NODE_ID not in route_locations:
        route_locations[NODE_ID] = NODE_LOCATION

    return route_locations


def _node_label(node_id: str, route_locations: dict[str, str]) -> str:
    location = route_locations.get(node_id)
    if not location:
        return node_id
    return f"{node_id} ({location})"


def _priority_to_rabbit(priority_raw: Any) -> int:
    try:
        return PacketPriority(int(priority_raw)).rabbit_priority
    except Exception:
        return PacketPriority.BULK.rabbit_priority


async def _notify_backend(
    client: httpx.AsyncClient,
    packet_id: str,
    status: str,
    detail: str,
    node_id: str | None = None,
    next_hop: str | None = None,
    hop_index: int | None = None,
    hop_total: int | None = None,
    from_node: str | None = None,
    to_node: str | None = None,
    from_location: str | None = None,
    to_location: str | None = None,
    time_elapsed: float | None = None,
    ttl_remaining: float | None = None,
    hop_delay_seconds: float | None = None,
) -> None:
    payload = {
        "packet_id": packet_id,
        "status": status,
        "detail": detail,
        "at": datetime.now(timezone.utc).isoformat(),
    }

    if node_id is not None:
        payload["node_id"] = node_id
    if next_hop is not None:
        payload["next_hop"] = next_hop
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
    if time_elapsed is not None:
        payload["time_elapsed"] = time_elapsed
    if ttl_remaining is not None:
        payload["ttl_remaining"] = ttl_remaining
    if hop_delay_seconds is not None:
        payload["hop_delay_seconds"] = hop_delay_seconds

    try:
        await client.post(BACKEND_STATUS_URL, json=payload, timeout=10.0)
    except Exception as exc:
        print(f"[worker:{NODE_ID}] failed status callback for packet {packet_id}: {exc}")


async def _fetch_packet(client: httpx.AsyncClient, packet_id: str) -> dict[str, Any] | None:
    try:
        response = await client.get(f"{BACKEND_PACKET_URL}/{packet_id}", timeout=10.0)
    except Exception as exc:
        print(f"[worker:{NODE_ID}] failed to read packet {packet_id}: {exc}")
        return None

    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        print(
            f"[worker:{NODE_ID}] unexpected status while reading packet {packet_id}: {response.status_code}"
        )
        return None

    try:
        return response.json()
    except Exception:
        return None


async def _fetch_nodes(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    try:
        response = await client.get(BACKEND_NODES_URL, timeout=10.0)
    except Exception as exc:
        print(f"[worker:{NODE_ID}] failed to read nodes: {exc}")
        return []

    if response.status_code >= 400:
        print(f"[worker:{NODE_ID}] failed to read nodes status={response.status_code}")
        return []

    try:
        payload = response.json()
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    return [item for item in payload if isinstance(item, dict)]


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


async def _publish_envelope(
    channel: aio_pika.Channel,
    declared_queues: set[str],
    envelope: dict[str, Any],
    target_node: str,
    rabbit_priority: int,
) -> None:
    target_queue = _queue_for_node(target_node)
    await _ensure_queue(channel, target_queue, declared_queues)

    message = aio_pika.Message(
        body=json.dumps(envelope, default=str).encode("utf-8"),
        content_type="application/json",
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        priority=rabbit_priority,
    )
    await channel.default_exchange.publish(message, routing_key=target_queue)


async def _sleep_for_hop(delay_seconds: float) -> None:
    # Base physics delay
    scaled_delay = max(0.01, min(5.0, delay_seconds * SIMULATION_TIME_SCALE))
    # 'Tryb symulacji': artificial 4-second delay per hop so the UI has time to draw beams and the user can see it step by step
    simulation_mode_delay = 4.0
    await asyncio.sleep(scaled_delay + simulation_mode_delay)


async def _process_message(
    message: aio_pika.IncomingMessage,
    channel: aio_pika.Channel,
    declared_queues: set[str],
    client: httpx.AsyncClient,
) -> None:
    async with message.process(requeue=False):
        try:
            envelope = json.loads(message.body.decode("utf-8"))
        except json.JSONDecodeError:
            print(f"[worker:{NODE_ID}] invalid JSON payload, dropping")
            return

        if not isinstance(envelope, dict):
            print(f"[worker:{NODE_ID}] payload is not object, dropping")
            return

        packet_id = envelope.get("packet_id")
        if not isinstance(packet_id, str) or not packet_id.strip():
            print(f"[worker:{NODE_ID}] message missing packet_id, dropping")
            return

        packet_id = packet_id.strip()
        current_node = _as_node_id(envelope.get("current_node"), NODE_ID)
        destination_node = _as_node_id(envelope.get("destination_node"), "")

        if not destination_node:
            print(f"[worker:{NODE_ID}] message missing destination_node, dropping")
            return

        if current_node != NODE_ID:
            print(f"[worker:{NODE_ID}] packet {packet_id} addressed to {current_node}; processing anyway")

        packet_doc = await _fetch_packet(client, packet_id)
        if not packet_doc:
            return

        if bool(packet_doc.get("cancel_requested", False)):
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="CANCELLED",
                detail=f"Packet cancelled before processing at {_node_label(current_node, {})}.",
                node_id=current_node,
            )
            return

        current_status = str(packet_doc.get("current_status", "")).upper()
        if current_status in {"DELIVERED", "FAILED", "FAILED_EXPIRED", "CANCELLED"}:
            return

        now = datetime.now(timezone.utc)

        ttl_seconds = _to_int(envelope.get("ttl_seconds"), default=3600)
        ttl_remaining = compute_ttl_remaining_seconds(
            earth_timestamp_iso=str(envelope.get("earth_timestamp", now.isoformat())),
            ttl_seconds=ttl_seconds,
            now=now,
        )

        if ttl_remaining <= 0:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="FAILED_EXPIRED",
                detail=f"Packet TTL expired at {_node_label(current_node, {})}.",
                node_id=current_node,
                ttl_remaining=0.0,
            )
            return

        hop_index = _to_int(envelope.get("hop_index"), default=0)
        hop_limit = _to_int(envelope.get("hop_limit"), default=10)
        hop_limit_remaining = max(1, hop_limit - hop_index)

        nodes = await _fetch_nodes(client)
        if not nodes:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="WAITING_RETRY",
                detail="Worker cannot fetch nodes. Requeueing.",
                node_id=current_node,
                ttl_remaining=float(ttl_remaining),
            )
            await asyncio.sleep(RETRY_REQUEUE_SECONDS)
            await _publish_envelope(
                channel=channel,
                declared_queues=declared_queues,
                envelope=envelope,
                target_node=current_node,
                rabbit_priority=message.priority or _priority_to_rabbit(envelope.get("priority")),
            )
            return

        route_locations = _extract_route_locations(nodes)
        next_hop, route_hops = pick_next_hop(
            current_node=current_node,
            destination_node=destination_node,
            nodes=nodes,
            now=now,
            ttl_remaining_seconds=ttl_remaining,
            hop_limit_remaining=hop_limit_remaining,
        )

        if not next_hop:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="WAITING_RETRY",
                detail=(
                    f"No route from {_node_label(current_node, route_locations)} to "
                    f"{_node_label(destination_node, route_locations)}. Requeueing."
                ),
                node_id=current_node,
                ttl_remaining=float(ttl_remaining),
            )
            await asyncio.sleep(RETRY_REQUEUE_SECONDS)
            await _publish_envelope(
                channel=channel,
                declared_queues=declared_queues,
                envelope=envelope,
                target_node=current_node,
                rabbit_priority=message.priority or _priority_to_rabbit(envelope.get("priority")),
            )
            return

        hop_delay_seconds = compute_hop_delay_seconds(current_node, next_hop, nodes)
        hop_total = hop_index + len(route_hops)

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="IN_TRANSIT",
            detail=(
                f"Hop {hop_index + 1}/{hop_total}: {_node_label(current_node, route_locations)} -> "
                f"{_node_label(next_hop, route_locations)}."
            ),
            node_id=current_node,
            next_hop=next_hop,
            hop_index=hop_index + 1,
            hop_total=hop_total,
            from_node=current_node,
            to_node=next_hop,
            from_location=route_locations.get(current_node),
            to_location=route_locations.get(next_hop),
            ttl_remaining=float(ttl_remaining),
            hop_delay_seconds=hop_delay_seconds,
        )

        await _sleep_for_hop(hop_delay_seconds)

        packet_after_hop = await _fetch_packet(client, packet_id)
        if packet_after_hop and bool(packet_after_hop.get("cancel_requested", False)):
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="CANCELLED",
                detail=(
                    f"Packet cancelled after hop at {_node_label(next_hop, route_locations)}."
                ),
                node_id=next_hop,
                next_hop=next_hop,
                hop_index=hop_index + 1,
                hop_total=hop_total,
                from_node=current_node,
                to_node=next_hop,
                from_location=route_locations.get(current_node),
                to_location=route_locations.get(next_hop),
            )
            return

        ttl_after_hop = compute_ttl_remaining_seconds(
            earth_timestamp_iso=str(envelope.get("earth_timestamp", now.isoformat())),
            ttl_seconds=ttl_seconds,
            now=datetime.now(timezone.utc),
        )
        if ttl_after_hop <= 0:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="FAILED_EXPIRED",
                detail=f"Packet TTL expired after hop to {_node_label(next_hop, route_locations)}.",
                node_id=next_hop,
                next_hop=next_hop,
                hop_index=hop_index + 1,
                hop_total=hop_total,
                from_node=current_node,
                to_node=next_hop,
                ttl_remaining=0.0,
            )
            return

        if next_hop == destination_node:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="DELIVERED",
                detail=(
                    f"Packet delivered at {_node_label(destination_node, route_locations)} "
                    f"after {hop_index + 1} hop(s)."
                ),
                node_id=destination_node,
                next_hop=destination_node,
                hop_index=hop_index + 1,
                hop_total=hop_total,
                from_node=current_node,
                to_node=destination_node,
                from_location=route_locations.get(current_node),
                to_location=route_locations.get(destination_node),
                ttl_remaining=float(ttl_after_hop),
            )
            return

        forwarded_envelope = {
            "packet_id": packet_id,
            "source_node": _as_node_id(envelope.get("source_node"), current_node),
            "destination_node": destination_node,
            "current_node": next_hop,
            "hop_index": hop_index + 1,
            "hop_limit": hop_limit,
            "earth_timestamp": envelope.get("earth_timestamp"),
            "ttl_seconds": ttl_seconds,
            "priority": _to_int(envelope.get("priority"), default=int(PacketPriority.BULK)),
            "payload": envelope.get("payload", {}),
            "route_preview": route_hops[1:],
            "route_locations": route_locations,
        }

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="QUEUED_ON_SOURCE",
            detail=f"Packet queued at {_node_label(next_hop, route_locations)} for next hop.",
            node_id=next_hop,
            next_hop=route_hops[1] if len(route_hops) > 1 else destination_node,
            hop_index=hop_index + 1,
            hop_total=hop_total,
            from_node=current_node,
            to_node=next_hop,
            from_location=route_locations.get(current_node),
            to_location=route_locations.get(next_hop),
            ttl_remaining=float(ttl_after_hop),
        )

        await _publish_envelope(
            channel=channel,
            declared_queues=declared_queues,
            envelope=forwarded_envelope,
            target_node=next_hop,
            rabbit_priority=message.priority or _priority_to_rabbit(envelope.get("priority")),
        )


async def _consume_forever() -> None:
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)

    declared_queues: set[str] = set()
    node_ids = [n.strip() for n in NODE_ID.split(",") if n.strip()]

    async with httpx.AsyncClient() as client:
        async def on_message(message: aio_pika.IncomingMessage) -> None:
            await _process_message(message, channel, declared_queues, client)

        for nid in node_ids:
            queue_name = f"{PACKET_QUEUE_PREFIX}.{nid}"
            await _ensure_queue(channel, queue_name, declared_queues)
            queue = await channel.get_queue(queue_name)
            
            if NODE_LOCATION:
                print(f"[worker:{nid}] location={NODE_LOCATION}; queue={queue_name}")
            else:
                print(f"[worker:{nid}] queue={queue_name}")

            await queue.consume(on_message)

        await asyncio.Future()

async def main() -> None:
    while True:
        try:
            await _consume_forever()
        except Exception as exc:
            print(f"[worker:{NODE_ID}] runtime error: {exc}; reconnecting in 5s")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
