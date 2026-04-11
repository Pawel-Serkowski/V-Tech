import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.cgr import CGREngine

import aio_pika
import httpx

SPEED_OF_LIGHT_KM_S = 299792.458
MAX_LOCAL_REROUTE_ATTEMPTS = 3

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
PACKET_QUEUE_PREFIX = os.getenv("PACKET_QUEUE_PREFIX", "packets")
PACKET_QUEUE_NAME = os.getenv("PACKET_QUEUE_NAME", "packets.priority").strip()
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

CONTACT_PLAN_PATH = os.getenv("CONTACT_PLAN_PATH", "").strip()
CONTACT_PLAN_JSON = os.getenv("CONTACT_PLAN_JSON", "").strip()
LINK_METRICS_JSON = os.getenv("LINK_METRICS_JSON", "").strip()
BACKEND_NODES_URL = os.getenv(
    "BACKEND_NODES_URL",
    "http://backend:8000/api/nodes?limit=5000",
)
CONTACT_PLAN_REFRESH_SECONDS = max(
    1,
    int(os.getenv("CONTACT_PLAN_REFRESH_SECONDS", "5")),
)
DEFAULT_BANDWIDTH_BPS = int(os.getenv("DEFAULT_BANDWIDTH_BPS", "1000000"))
DEFAULT_RANGE_KM = float(os.getenv("DEFAULT_RANGE_KM", "384000"))


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
    if PACKET_QUEUE_NAME:
        return PACKET_QUEUE_NAME
    prefix = PACKET_QUEUE_PREFIX.strip() or "packets"
    return f"{prefix}.{_sanitize_node_id(node_id)}"


MY_QUEUE = _queue_for_node(NODE_ID)


def _to_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return None


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _as_node_id(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


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
        if not isinstance(key, str) or not isinstance(value, str):
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


def _ttl_metrics(data: dict[str, Any], now: datetime) -> tuple[float | None, float | None]:
    earth_ts = _to_utc_datetime(data.get("earth_timestamp"))
    expire_at = _to_utc_datetime(data.get("expire_at"))

    time_elapsed: float | None = None
    if earth_ts is not None:
        time_elapsed = max(0.0, (now - earth_ts).total_seconds())

    ttl_remaining: float | None = None
    if expire_at is not None:
        ttl_remaining = (expire_at - now).total_seconds()
    elif time_elapsed is not None:
        try:
            ttl_seconds = float(data.get("ttl_seconds"))
            ttl_remaining = ttl_seconds - time_elapsed
        except Exception:
            ttl_remaining = None

    return time_elapsed, ttl_remaining


def _envelope_size_bytes(envelope: dict[str, Any]) -> int:
    return len(json.dumps(envelope, default=str, separators=(",", ":")).encode("utf-8"))


def calculate_link_delays(
    packet_size_bytes: int,
    bandwidth_bps: int,
    range_km: float,
) -> tuple[float, float]:
    if bandwidth_bps <= 0:
        return float("inf"), float("inf")

    packet_size_bits = packet_size_bytes * 8
    propagation_delay = range_km / SPEED_OF_LIGHT_KM_S
    transmission_delay = packet_size_bits / bandwidth_bps
    return propagation_delay, transmission_delay


def _load_contact_plan() -> list[dict[str, Any]]:
    payload = []
    if CONTACT_PLAN_JSON:
        try:
            payload = json.loads(CONTACT_PLAN_JSON)
        except Exception as exc:
            print(f"[worker2:{NODE_ID}] invalid CONTACT_PLAN_JSON: {exc}")
    elif CONTACT_PLAN_PATH:
        try:
            with open(CONTACT_PLAN_PATH, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception as exc:
            print(f"[worker2:{NODE_ID}] failed to read CONTACT_PLAN_PATH: {exc}")
            
    if isinstance(payload, list):
        # TUTAJ NAPRAWIAMY BŁĄD DAT: Zamieniamy stringi na obiekty datetime
        for contact in payload:
            for window in contact.get("windows", []):
                if isinstance(window.get("start"), str):
                    window["start"] = _to_utc_datetime(window["start"])
                if isinstance(window.get("end"), str):
                    window["end"] = _to_utc_datetime(window["end"])
        return payload

    return []


def _load_static_link_metrics() -> dict[str, dict[str, float]]:
    if not LINK_METRICS_JSON:
        return {}

    try:
        payload = json.loads(LINK_METRICS_JSON)
    except Exception as exc:
        print(f"[worker2:{NODE_ID}] invalid LINK_METRICS_JSON: {exc}")
        return {}

    if not isinstance(payload, dict):
        return {}

    metrics: dict[str, dict[str, float]] = {}
    for key, value in payload.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue

        bandwidth_bps = _to_int(value.get("bandwidth_bps"), DEFAULT_BANDWIDTH_BPS)
        avg_range_km = _to_float(value.get("avg_range_km"), DEFAULT_RANGE_KM)
        metrics[key] = {
            "bandwidth_bps": float(max(1, bandwidth_bps)),
            "avg_range_km": float(max(1.0, avg_range_km)),
        }

    return metrics


CONTACT_PLAN = _load_contact_plan()
STATIC_LINK_METRICS = _load_static_link_metrics()
_LINK_LOCKS: dict[str, asyncio.Lock] = {}
_CONTACT_PLAN_LAST_REFRESH = datetime.min.replace(tzinfo=timezone.utc)
_CONTACT_PLAN_REFRESH_LOCK = asyncio.Lock()


def _get_link_lock(from_node: str, to_node: str) -> asyncio.Lock:
    key = f"{from_node}->{to_node}"
    lock = _LINK_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _LINK_LOCKS[key] = lock
    return lock


def _extract_link_metrics_from_data(
    data: dict[str, Any],
    from_node: str,
    to_node: str,
) -> tuple[int, float]:
    direct = data.get("link_profile")
    if isinstance(direct, dict):
        bandwidth_bps = _to_int(direct.get("bandwidth_bps"), DEFAULT_BANDWIDTH_BPS)
        avg_range_km = _to_float(direct.get("avg_range_km"), DEFAULT_RANGE_KM)
        return max(1, bandwidth_bps), max(1.0, avg_range_km)

    by_hop = data.get("hop_link_profiles")
    hop_key = f"{from_node}->{to_node}"
    if isinstance(by_hop, dict) and isinstance(by_hop.get(hop_key), dict):
        hop_item = by_hop[hop_key]
        bandwidth_bps = _to_int(hop_item.get("bandwidth_bps"), DEFAULT_BANDWIDTH_BPS)
        avg_range_km = _to_float(hop_item.get("avg_range_km"), DEFAULT_RANGE_KM)
        return max(1, bandwidth_bps), max(1.0, avg_range_km)

    static_item = STATIC_LINK_METRICS.get(hop_key)
    if isinstance(static_item, dict):
        bandwidth_bps = _to_int(static_item.get("bandwidth_bps"), DEFAULT_BANDWIDTH_BPS)
        avg_range_km = _to_float(static_item.get("avg_range_km"), DEFAULT_RANGE_KM)
        return max(1, bandwidth_bps), max(1.0, avg_range_km)

    return max(1, DEFAULT_BANDWIDTH_BPS), max(1.0, DEFAULT_RANGE_KM)


def _flatten_nodes_to_contact_plan(nodes: Any) -> list[dict[str, Any]]:
    if not isinstance(nodes, list):
        return []

    contact_plan: list[dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue

        source_id = node.get("node_id")
        if not isinstance(source_id, str) or not source_id.strip():
            continue
        source_id = source_id.strip()

        shared_windows = node.get("contact_windows") if isinstance(node.get("contact_windows"), list) else []

        for link in node.get("links", []):
            if isinstance(link, str):
                contact_plan.append(
                    {
                        "source": source_id,
                        "dest": link,
                        "bandwidth_bps": DEFAULT_BANDWIDTH_BPS,
                        "windows": shared_windows,
                    }
                )
                continue

            if not isinstance(link, dict):
                continue

            dest_node = link.get("dest_node")
            if not isinstance(dest_node, str) or not dest_node.strip():
                continue

            windows = link.get("windows", [])
            if not isinstance(windows, list):
                windows = []

            contact_plan.append(
                {
                    "source": source_id,
                    "dest": dest_node,
                    "bandwidth_bps": _to_int(link.get("bandwidth_bps"), DEFAULT_BANDWIDTH_BPS),
                    "windows": windows,
                }
            )

    return contact_plan


async def _refresh_contact_plan_if_needed(client: httpx.AsyncClient) -> None:
    global CONTACT_PLAN
    global _CONTACT_PLAN_LAST_REFRESH

    # If worker has static contact plan configured, keep it as source of truth.
    if CONTACT_PLAN_PATH or CONTACT_PLAN_JSON:
        return

    now = datetime.now(timezone.utc)
    if (now - _CONTACT_PLAN_LAST_REFRESH).total_seconds() < CONTACT_PLAN_REFRESH_SECONDS:
        return

    async with _CONTACT_PLAN_REFRESH_LOCK:
        now = datetime.now(timezone.utc)
        if (now - _CONTACT_PLAN_LAST_REFRESH).total_seconds() < CONTACT_PLAN_REFRESH_SECONDS:
            return

        try:
            response = await client.get(BACKEND_NODES_URL, timeout=10.0)
            if response.status_code >= 400:
                print(
                    f"[worker2:{NODE_ID}] nodes refresh failed: {response.status_code}"
                )
                _CONTACT_PLAN_LAST_REFRESH = now
                return

            nodes = response.json()
            refreshed = _flatten_nodes_to_contact_plan(nodes)
            if refreshed:
                CONTACT_PLAN = refreshed
            _CONTACT_PLAN_LAST_REFRESH = now
        except Exception as exc:
            print(f"[worker2:{NODE_ID}] nodes refresh error: {exc}")
            _CONTACT_PLAN_LAST_REFRESH = now


def _find_contact_window(
    from_node: str,
    to_node: str,
    now_utc: datetime,
    contact_plan: list[dict[str, Any]],
) -> tuple[datetime | None, datetime | None, int, float]:
    metrics_bandwidth, metrics_range = _extract_link_metrics_from_data({}, from_node, to_node)

    candidate_start: datetime | None = None
    candidate_end: datetime | None = None

    for contact in contact_plan:
        if not isinstance(contact, dict):
            continue
        if contact.get("source") != from_node or contact.get("dest") != to_node:
            continue

        bandwidth_bps = _to_int(contact.get("bandwidth_bps"), metrics_bandwidth)
        for window in contact.get("windows", []):
            if not isinstance(window, dict):
                continue
            start = _to_utc_datetime(window.get("start"))
            end = _to_utc_datetime(window.get("end"))
            if start is None or end is None or end <= now_utc:
                continue

            if candidate_start is None or start < candidate_start:
                candidate_start = max(start, now_utc)
                candidate_end = end
                metrics_bandwidth = max(1, bandwidth_bps)
                metrics_range = max(1.0, _to_float(window.get("avg_range_km"), metrics_range))

            if start <= now_utc <= end:
                return now_utc, end, max(1, bandwidth_bps), max(
                    1.0,
                    _to_float(window.get("avg_range_km"), metrics_range),
                )

    return candidate_start, candidate_end, max(1, metrics_bandwidth), max(1.0, metrics_range)


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
    time_elapsed: float | None = None,
    ttl_remaining: float | None = None,
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
    if time_elapsed is not None:
        payload["time_elapsed"] = time_elapsed
    if ttl_remaining is not None:
        payload["ttl_remaining"] = ttl_remaining

    try:
        await client.post(BACKEND_STATUS_URL, json=payload, timeout=10.0)
    except Exception as exc:
        print(f"[worker2] failed status callback for packet {packet_id}: {exc}")


async def _is_cancel_requested(client: httpx.AsyncClient, packet_id: str) -> bool:
    try:
        response = await client.get(f"{BACKEND_PACKETS_URL}/{packet_id}", timeout=10.0)
    except Exception as exc:
        print(f"[worker2] failed to read packet {packet_id}: {exc}")
        return False

    if response.status_code == 404:
        return False

    if response.status_code >= 400:
        print(
            f"[worker2] unexpected status while reading packet {packet_id}: "
            f"{response.status_code}"
        )
        return False

    try:
        packet_doc = response.json()
    except Exception:
        return False

    return bool(packet_doc.get("cancel_requested", False))


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


async def _wait_until_arrival_if_needed(
    data: dict[str, Any],
    packet_id: str,
) -> None:
    not_before = _to_utc_datetime(data.get("not_before"))
    if not_before is None:
        return

    now = datetime.now(timezone.utc)
    if now >= not_before:
        return

    wait_seconds = (not_before - now).total_seconds()
    print(
        f"[worker2:{NODE_ID}] packet {packet_id} waiting {wait_seconds:.3f}s for propagation arrival"
    )
    await asyncio.sleep(wait_seconds)


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
            print(f"[worker2:{NODE_ID}] invalid JSON payload!!, dropping")
            return

        packet_id = data.get("packet_id")
        if not packet_id:
            print(f"[worker2:{NODE_ID}] message missing packet_id!!, dropping")
            return

        await _wait_until_arrival_if_needed(data, packet_id)

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

        now = datetime.now(timezone.utc)
        time_elapsed, ttl_remaining = _ttl_metrics(data, now)

        await _refresh_contact_plan_if_needed(client)
        current_contact_plan = CONTACT_PLAN

        if ttl_remaining is not None and ttl_remaining <= 0:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="FAILED_EXPIRED",
                next_hop=None,
                detail=f"Packet TTL expired in queue at {_node_label(current_node, route_locations)}.",
                node_id=current_node,
                from_node=current_node,
                time_elapsed=time_elapsed,
                ttl_remaining=0.0,
            )
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
                f"[worker2:{NODE_ID}] packet {packet_id} expected node {current_node}; processing anyway"
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
                time_elapsed=time_elapsed,
                ttl_remaining=ttl_remaining,
            )
            return

        await _notify_backend(
            client=client,
            packet_id=packet_id,
            status="IN_TRANSIT",
            next_hop=to_node,
            detail=(
                f"Hop {hop_index}/{hop_total}: "
                f"{_node_label(current_node, route_locations)} -> {_node_label(to_node, route_locations)}."
            ),
            node_id=current_node,
            hop_index=hop_index,
            hop_total=hop_total,
            from_node=current_node,
            to_node=to_node,
            from_location=from_location,
            to_location=to_location,
            time_elapsed=time_elapsed,
            ttl_remaining=ttl_remaining,
        )

        forwarded_envelope = {
            "packet_id": packet_id,
            "source_node": source_node,
            "destination_node": data.get("destination_node"),
            "current_node": to_node,
            "next_hop": next_hops[0] if next_hops else None,
            "remaining_hops": next_hops,
            "hop_index": hop_index,
            "hop_total": hop_total,
            "route_hops": route_hops,
            "route_locations": route_locations,
            "earth_timestamp": data.get("earth_timestamp"),
            "ttl_seconds": data.get("ttl_seconds"),
            "hop_limit": data.get("hop_limit"),
            "expire_at": data.get("expire_at"),
            "priority": data.get("priority"),
            "payload": data.get("payload", {}),
            "hop_link_profiles": data.get("hop_link_profiles"),
        }

        packet_size_bytes = _envelope_size_bytes(forwarded_envelope)
        lock = _get_link_lock(current_node, to_node)

        async with lock:
            lock_now = datetime.now(timezone.utc)
            window_start, window_end, bandwidth_bps, avg_range_km = _find_contact_window(
                current_node,
                to_node,
                lock_now,
                current_contact_plan,
            )

            from_data_bandwidth, from_data_range = _extract_link_metrics_from_data(
                data,
                current_node,
                to_node,
            )
            has_window = window_start is not None and window_end is not None
            if has_window:
                bandwidth_bps = max(1, bandwidth_bps)
                avg_range_km = max(1.0, avg_range_km)
            else:
                bandwidth_bps = from_data_bandwidth
                avg_range_km = from_data_range

            wait_for_window_seconds = 0.0
            if has_window and window_start is not None:
                wait_for_window_seconds = max(0.0, (window_start - lock_now).total_seconds())
                if wait_for_window_seconds > 0:
                    await asyncio.sleep(wait_for_window_seconds)

            now_before_tx = datetime.now(timezone.utc)
            _, ttl_remaining_before_tx = _ttl_metrics(data, now_before_tx)
            if ttl_remaining_before_tx is not None and ttl_remaining_before_tx <= 0:
                await _notify_backend(
                    client=client,
                    packet_id=packet_id,
                    status="FAILED_EXPIRED",
                    next_hop=to_node,
                    detail=(
                        f"Packet TTL expired while waiting for contact window before hop "
                        f"{hop_index}/{hop_total}."
                    ),
                    node_id=current_node,
                    hop_index=hop_index,
                    hop_total=hop_total,
                    from_node=current_node,
                    to_node=to_node,
                    from_location=from_location,
                    to_location=to_location,
                    ttl_remaining=0.0,
                )
                return

            propagation_delay, transmission_delay = calculate_link_delays(
                packet_size_bytes=packet_size_bytes,
                bandwidth_bps=bandwidth_bps,
                range_km=avg_range_km,
            )

            if transmission_delay == float("inf") or propagation_delay == float("inf"):
                await _notify_backend(
                    client=client,
                    packet_id=packet_id,
                    status="FAILED",
                    next_hop=to_node,
                    detail="Invalid link bandwidth while forwarding packet.",
                    node_id=current_node,
                    hop_index=hop_index,
                    hop_total=hop_total,
                    from_node=current_node,
                    to_node=to_node,
                )
                return

            start_tx = datetime.now(timezone.utc)
            
            needs_reroute = False
            
            if not has_window:
                needs_reroute = True  
            else:
                end_rx_expected = start_tx.timestamp() + transmission_delay + propagation_delay
                if end_rx_expected > window_end.timestamp():
                    needs_reroute = True # there is a window but we cant make it in time
                    
            if needs_reroute:
                reroute_count = _to_int(data.get("reroute_count"), 0)
                print(f"[worker2:{NODE_ID}] Original route failed or no window. Attempting local re-routing for {packet_id}")
                
                if reroute_count >= MAX_LOCAL_REROUTE_ATTEMPTS:
                    print(f"[worker2:{NODE_ID}] Max local reroute attempts reached for {packet_id}!!!. Dropping.")
                    await _notify_backend(
                        client=client,
                        packet_id=packet_id,
                        status="FAILED",
                        next_hop=to_node,
                        detail=f"Exceeded {MAX_LOCAL_REROUTE_ATTEMPTS} local reroute attempts.",
                        node_id=current_node
                    )
                    return

                print(f"[worker2:{NODE_ID}] Attempting local re-routing (attempt {reroute_count + 1})")
                        
                new_route = CGREngine.compute_route_hops(
                    source_node=current_node,
                    destination_node=data.get("destination_node"),
                    contact_plan=current_contact_plan,
                    earth_timestamp=datetime.now(timezone.utc),
                    packet_size_bytes=packet_size_bytes,
                    ttl_seconds=int(ttl_remaining or 3600),
                    hop_limit=int(data.get("hop_limit", 10))
                )

                if new_route:
                    print(f"[worker2:{NODE_ID}] Found new route for {packet_id} via {new_route[0]}. Re-queueing locally.")
                    data["route_hops"] = new_route
                    data["remaining_hops"] = new_route
                    data["next_hop"] = new_route[0]
                    data["reroute_count"] = reroute_count + 1
                    await _forward_to_next_node(
                        channel=channel,
                        declared_queues=declared_queues,
                        envelope=data, 
                        to_node=NODE_ID, 
                        rabbit_priority=message.priority
                    )
                    return 
                else:
                    print(f"[worker2:{NODE_ID}] No alternative route found for {packet_id}. Dropping.")
                    await _notify_backend(
                        client=client,
                        packet_id=packet_id,
                        status="FAILED",
                        next_hop=to_node,
                        detail="Route failed (no valid window) and no alternative route could be calculated.",
                        node_id=current_node,
                        hop_index=hop_index,
                        hop_total=hop_total,
                        from_node=current_node,
                        to_node=to_node,
                    )
                    return #rejection of a packet, because there is no possible way to find route in a given ttl time
                    
            await asyncio.sleep(transmission_delay)
            arrival_time = datetime.fromtimestamp(
                start_tx.timestamp() + transmission_delay + propagation_delay,
                tz=timezone.utc,
            )
            forwarded_envelope["not_before"] = arrival_time.isoformat()
            forwarded_envelope["tx_seconds"] = transmission_delay
            forwarded_envelope["prop_seconds"] = propagation_delay
            forwarded_envelope["bandwidth_bps"] = bandwidth_bps
            forwarded_envelope["avg_range_km"] = avg_range_km
            forwarded_envelope["packet_size_bytes"] = packet_size_bytes

            if await _is_cancel_requested(client, packet_id):
                await _notify_backend(
                    client=client,
                    packet_id=packet_id,
                    status="CANCELLED",
                    next_hop=to_node,
                    detail=(
                        f"Transmission cancelled after hop {hop_index}/{hop_total} at "
                        f"{_node_label(current_node, route_locations)}."
                    ),
                    node_id=current_node,
                    hop_index=hop_index,
                    hop_total=hop_total,
                    from_node=current_node,
                    to_node=to_node,
                )
                return

            if next_hops:
                await _forward_to_next_node(
                    channel=channel,
                    declared_queues=declared_queues,
                    envelope=forwarded_envelope,
                    to_node=to_node,
                    rabbit_priority=message.priority,
                )
            else:
                await asyncio.sleep(propagation_delay)

        now_after_hop = datetime.now(timezone.utc)
        time_elapsed_after_hop, ttl_remaining_after_hop = _ttl_metrics(data, now_after_hop)
        if ttl_remaining_after_hop is not None and ttl_remaining_after_hop <= 0:
            await _notify_backend(
                client=client,
                packet_id=packet_id,
                status="FAILED_EXPIRED",
                next_hop=to_node,
                detail=(
                    f"Packet TTL expired during hop {hop_index}/{hop_total} before reaching "
                    f"{_node_label(to_node, route_locations)}."
                ),
                node_id=to_node,
                hop_index=hop_index,
                hop_total=hop_total,
                from_node=current_node,
                to_node=to_node,
                from_location=from_location,
                to_location=to_location,
                time_elapsed=time_elapsed_after_hop,
                ttl_remaining=0.0,
            )
            return

        if next_hops:
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
            time_elapsed=time_elapsed_after_hop,
            ttl_remaining=ttl_remaining_after_hop,
        )


async def _consume_forever() -> None:
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)

    declared_queues: set[str] = set()

    await _ensure_queue(channel, MY_QUEUE, declared_queues)
    queue = await channel.get_queue(MY_QUEUE)

    if NODE_LOCATION:
        print(f"[worker2:{NODE_ID}] location={NODE_LOCATION}; queue={MY_QUEUE}")
    else:
        print(f"[worker2:{NODE_ID}] queue={MY_QUEUE}")

    print(
        f"[worker2:{NODE_ID}] contact_plan={len(CONTACT_PLAN)} links; "
        f"static_metrics={len(STATIC_LINK_METRICS)}"
    )

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
            print(f"[worker2] runtime error: {exc}; reconnecting in 5s")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
