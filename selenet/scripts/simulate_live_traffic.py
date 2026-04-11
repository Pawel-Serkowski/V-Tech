#!/usr/bin/env python3

import argparse
import json
import random
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

TERMINAL_STATUSES = {"DELIVERED", "FAILED", "ERROR", "CANCELLED"}

EARTH_HINTS = (
    "earth",
    "ground",
    "mission control",
    "terrestrial",
    "terra",
)

MOON_HINTS = (
    "moon",
    "lunar",
    "luna",
    "selene",
    "nrho",
)

BASE_HINTS = (
    "ground_station",
    "relay",
    "base",
    "station",
    "gateway",
    "control",
    "hub",
)


def request_json(base_url: str, path: str, method: str = "GET", payload: dict | None = None):
    url = f"{base_url}{path}"
    body = None
    headers = {}

    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = response.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace").strip()
        detail = response_body or str(exc.reason)
        raise RuntimeError(f"HTTP {exc.code} {method} {path}: {detail}") from exc


def fetch_nodes(base_url: str):
    return request_json(base_url, "/api/nodes?limit=1000")


def fetch_packets(base_url: str):
    return request_json(base_url, "/api/packets?limit=400")


def build_graph(nodes: list[dict]):
    graph = {}
    for node in nodes:
        node_id = node.get("node_id")
        if not node_id:
            continue
        links = []
        for link in node.get("links") or []:
            if isinstance(link, dict):
                dest = link.get("dest_node")
                if isinstance(dest, str) and dest:
                    links.append(dest)
        graph[node_id] = links
    return graph


def reachable_from(graph: dict[str, list[str]], start: str):
    seen = {start}
    queue = [start]

    while queue:
        current = queue.pop(0)
        for nxt in graph.get(current, []):
            if nxt in graph and nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)

    return seen


def classify_node_side(node: dict):
    text = node_text(node)

    earth_score = sum(1 for token in EARTH_HINTS if token in text)
    moon_score = sum(1 for token in MOON_HINTS if token in text)

    if earth_score > moon_score:
        return "earth"
    if moon_score > earth_score:
        return "moon"
    return None


def node_text(node: dict):
    return " ".join(
        [
            str(node.get("node_id") or ""),
            str(node.get("node_type") or ""),
            str(node.get("orbit") or ""),
            str(node.get("location_label") or ""),
        ]
    ).lower()


def is_base_like(node: dict):
    node_type = str(node.get("node_type") or "")
    if node_type in {"ground_station", "relay"}:
        return True

    # Keep endpoint roles strict: satellite nodes are not treated as base endpoints
    # even if their orbit labels contain words like "relay".
    if node_type == "satellite":
        return False

    text = " ".join(
        [
            str(node.get("node_id") or ""),
            str(node.get("location_label") or ""),
        ]
    ).lower()
    return any(token in text for token in BASE_HINTS)


def infer_endpoint_groups(nodes: list[dict]):
    earth_base_nodes = []
    moon_base_nodes = []
    earth_any_nodes = []
    moon_any_nodes = []

    for node in nodes:
        node_id = str(node.get("node_id") or "").strip()
        if not node_id:
            continue

        side = classify_node_side(node)
        if side == "earth":
            earth_any_nodes.append(node_id)
            if is_base_like(node):
                earth_base_nodes.append(node_id)
        elif side == "moon":
            moon_any_nodes.append(node_id)
            if is_base_like(node):
                moon_base_nodes.append(node_id)

    return {
        "earth_base": earth_base_nodes,
        "moon_base": moon_base_nodes,
        "earth_any": earth_any_nodes,
        "moon_any": moon_any_nodes,
    }


def choose_reachable_pair(graph: dict[str, list[str]], sources: list[str], destinations: list[str]):
    if not sources or not destinations:
        return None

    random_sources = sources[:]
    random.shuffle(random_sources)

    for source in random_sources:
        reachable = reachable_from(graph, source)
        valid_destinations = [node_id for node_id in destinations if node_id in reachable and node_id != source]
        if not valid_destinations:
            continue
        return source, random.choice(valid_destinations)

    return None


def choose_source_destination(nodes: list[dict], *, enforce_cross_body: bool = True):
    graph = build_graph(nodes)
    node_ids = sorted(graph.keys())

    if len(node_ids) < 2:
        raise RuntimeError("Need at least 2 nodes in /api/nodes")

    if not enforce_cross_body:
        sources = [node_id for node_id, links in graph.items() if links]
        source = random.choice(sources or node_ids)

        reachable = sorted(reachable_from(graph, source) - {source})
        if reachable:
            destination = random.choice(reachable)
        else:
            destination_candidates = [node_id for node_id in node_ids if node_id != source]
            destination = random.choice(destination_candidates)

        return source, destination

    groups = infer_endpoint_groups(nodes)

    earth_base = [node_id for node_id in groups["earth_base"] if node_id in graph]
    moon_base = [node_id for node_id in groups["moon_base"] if node_id in graph]
    earth_any = [node_id for node_id in groups["earth_any"] if node_id in graph]
    moon_any = [node_id for node_id in groups["moon_any"] if node_id in graph]

    if not earth_any or not moon_any:
        raise RuntimeError(
            "No Earth/Moon endpoint groups inferred from node metadata. "
            "Use --allow-same-side to restore unrestricted random routing."
        )

    directional_candidates = [
        (earth_base or earth_any, moon_base or moon_any),
        (moon_base or moon_any, earth_base or earth_any),
        (earth_any, moon_any),
        (moon_any, earth_any),
    ]
    random.shuffle(directional_candidates)

    for sources, destinations in directional_candidates:
        pair = choose_reachable_pair(graph, sources, destinations)
        if pair:
            return pair

    raise RuntimeError(
        "No cross-body path available (Earth<->Moon). "
        "Use --allow-same-side to restore unrestricted random routing."
    )


def sample_coordinates():
    return {
        "lat": round(random.uniform(-89.9, 89.9), 4),
        "lon": round(random.uniform(-179.9, 179.9), 4),
        "alt_km": round(random.uniform(180.0, 42000.0), 2),
    }


def payload_telemetry(seq: int, ts: str, source_node: str, destination_node: str):
    return {
        "kind": "telemetry",
        "seq": seq,
        "ts": ts,
        "source": source_node,
        "destination": destination_node,
        "subsystem": random.choice(["power", "thermal", "attitude", "payload"]),
        "metrics": {
            "temp_c": round(random.uniform(-70.0, 45.0), 2),
            "voltage_v": round(random.uniform(22.0, 33.0), 2),
            "cpu_load": round(random.uniform(0.05, 0.98), 3),
            "mem_used_mb": random.randint(128, 4096),
        },
        "position": sample_coordinates(),
    }


def payload_health(seq: int, ts: str, source_node: str, destination_node: str):
    checks = [
        {"name": "battery", "ok": random.random() > 0.08},
        {"name": "comms", "ok": random.random() > 0.05},
        {"name": "clock", "ok": random.random() > 0.03},
        {"name": "storage", "ok": random.random() > 0.07},
    ]
    return {
        "kind": "health",
        "seq": seq,
        "ts": ts,
        "source": source_node,
        "destination": destination_node,
        "summary": "ok" if all(item["ok"] for item in checks) else "degraded",
        "checks": checks,
        "uptime_s": random.randint(1200, 5_000_000),
    }


def payload_science(seq: int, ts: str, source_node: str, destination_node: str):
    sample_len = random.randint(8, 16)
    return {
        "kind": "science",
        "seq": seq,
        "ts": ts,
        "source": source_node,
        "destination": destination_node,
        "instrument": random.choice(["spectrometer", "radar", "neutron", "camera"]),
        "window": {
            "start": ts,
            "duration_s": random.randint(30, 900),
        },
        "samples": [round(random.uniform(0.0, 1.0), 5) for _ in range(sample_len)],
        "tags": random.sample(["ice", "regolith", "plasma", "dust", "crater"], k=2),
    }


def payload_link_status(seq: int, ts: str, source_node: str, destination_node: str):
    return {
        "kind": "link-status",
        "seq": seq,
        "ts": ts,
        "source": source_node,
        "destination": destination_node,
        "link": {
            "snr_db": round(random.uniform(1.0, 28.0), 2),
            "rssi_dbm": round(random.uniform(-130.0, -72.0), 1),
            "ber": round(random.uniform(0.0, 0.08), 5),
            "queue_depth": random.randint(0, 120),
            "window_open": random.random() > 0.2,
        },
        "channel": random.choice(["x-band", "ka-band", "s-band"]),
    }


def payload_routing(seq: int, ts: str, source_node: str, destination_node: str):
    candidate_count = random.randint(2, 4)
    candidates = []
    for idx in range(candidate_count):
        candidates.append(
            {
                "id": f"path-{idx + 1}",
                "hops": random.randint(1, 5),
                "score": round(random.uniform(0.1, 0.99), 3),
                "delay_s": round(random.uniform(1.2, 220.0), 2),
            }
        )

    return {
        "kind": "routing",
        "seq": seq,
        "ts": ts,
        "source": source_node,
        "destination": destination_node,
        "policy": random.choice(["cgr-fast", "cgr-safe", "cgr-balance"]),
        "candidates": candidates,
        "selected": max(candidates, key=lambda item: item["score"])["id"],
    }


def payload_event(seq: int, ts: str, source_node: str, destination_node: str):
    event_type = random.choice(["handover", "window-open", "window-close", "retry-trigger", "priority-override"])
    return {
        "kind": "event",
        "seq": seq,
        "ts": ts,
        "source": source_node,
        "destination": destination_node,
        "event": {
            "type": event_type,
            "severity": random.choice(["info", "warn", "critical"]),
            "acked": random.random() > 0.5,
            "code": f"EV-{random.randint(100, 999)}",
        },
        "context": {
            "session": f"sess-{random.randint(10, 99)}",
            "operator": random.choice(["autopilot", "ground", "planner"]),
        },
    }


PAYLOAD_GENERATORS = [
    payload_telemetry,
    payload_health,
    payload_science,
    payload_link_status,
    payload_routing,
    payload_event,
]


def make_payload(seq: int, source_node: str, destination_node: str):
    ts = datetime.now(timezone.utc).isoformat()
    payload = random.choice(PAYLOAD_GENERATORS)(seq, ts, source_node, destination_node)
    payload["trace_id"] = f"trc-{seq:05d}-{random.randint(1000, 9999)}"
    return payload


def random_priority(kind: str | None = None):
    # 1 = critical, 2 = high, 3 = bulk
    if kind in {"event", "routing"}:
        return random.choices([1, 2, 3], weights=[0.35, 0.45, 0.20], k=1)[0]
    if kind in {"science"}:
        return random.choices([1, 2, 3], weights=[0.12, 0.33, 0.55], k=1)[0]
    return random.choices([1, 2, 3], weights=[0.2, 0.35, 0.45], k=1)[0]


def maybe_cancel_packet(base_url: str, cancel_probability: float):
    if random.random() > cancel_probability:
        return None

    rows = fetch_packets(base_url)
    active = [
        row
        for row in rows
        if str(row.get("current_status", "")).upper() not in TERMINAL_STATUSES
    ]

    if not active:
        return None

    victim = random.choice(active)
    packet_id = victim.get("packet_id")
    if not packet_id:
        return None

    try:
        request_json(base_url, f"/api/packets/{packet_id}/cancel", method="POST")
        return packet_id
    except RuntimeError:
        return None


def main():
    parser = argparse.ArgumentParser(description="Generate live packet traffic for visualization.")
    parser.add_argument("--api-base-url", default="http://localhost:8001")
    parser.add_argument("--duration", type=float, default=120.0, help="How long to run [seconds].")
    parser.add_argument("--interval", type=float, default=1.4, help="Dispatch interval [seconds].")
    parser.add_argument("--cancel-prob", type=float, default=0.28, help="Chance to cancel one active packet each tick.")
    parser.add_argument("--refresh-nodes-every", type=int, default=12, help="Refresh node list every N ticks.")
    parser.add_argument(
        "--allow-same-side",
        action="store_true",
        help="Allow random traffic within the same side (Earth->Earth / Moon->Moon).",
    )
    args = parser.parse_args()

    base_url = args.api_base_url.rstrip("/")
    tick = 0
    seq = 1
    started = time.monotonic()

    stats = {
        "sent": 0,
        "cancelled": 0,
        "errors": 0,
    }

    try:
        nodes = fetch_nodes(base_url)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Cannot load nodes from API ({base_url}/api/nodes): {exc}") from exc

    if len(nodes) < 2:
        raise RuntimeError("Need at least 2 nodes in backend before traffic simulation.")

    mode = "unrestricted" if args.allow_same_side else "cross-body-only"
    print(f"[live-traffic] start base={base_url} duration={args.duration}s interval={args.interval}s mode={mode}")
    while time.monotonic() - started < args.duration:
        try:
            if tick % max(args.refresh_nodes_every, 1) == 0:
                nodes = fetch_nodes(base_url)

            source, destination = choose_source_destination(nodes, enforce_cross_body=not args.allow_same_side)
            payload = make_payload(seq, source, destination)
            payload_kind = str(payload.get("kind", "unknown"))
            priority = random_priority(payload_kind)

            ack = request_json(
                base_url,
                "/api/packets",
                method="POST",
                payload={
                    "source_node": source,
                    "destination_node": destination,
                    "priority": priority,
                    "payload": payload,
                },
            )

            packet_id = ack.get("packet_id", "unknown")
            route = ack.get("route_hops") or []
            print(
                f"[dispatch] #{seq:04d} id={packet_id} kind={payload_kind} prio={priority} {source} -> {destination} hops={route}",
                flush=True,
            )
            stats["sent"] += 1
            seq += 1

            cancelled_id = maybe_cancel_packet(base_url, args.cancel_prob)
            if cancelled_id:
                print(f"[cancel] packet_id={cancelled_id}", flush=True)
                stats["cancelled"] += 1

        except Exception as exc:  # noqa: BLE001
            stats["errors"] += 1
            print(f"[error] {exc}", flush=True)

        tick += 1
        time.sleep(max(args.interval, 0.2))

    print(
        "[live-traffic] done "
        f"sent={stats['sent']} cancelled={stats['cancelled']} errors={stats['errors']}",
        flush=True,
    )


if __name__ == "__main__":
    main()
