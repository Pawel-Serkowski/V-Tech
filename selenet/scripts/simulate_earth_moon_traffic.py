#!/usr/bin/env python3

import argparse
import json
import random
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

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


def normalize_node_id_list(values: list[str] | None):
    if not values:
        return []
    result = []
    seen = set()
    for value in values:
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def node_text(node: dict):
    fragments = [
        str(node.get("node_id") or ""),
        str(node.get("node_type") or ""),
        str(node.get("orbit") or ""),
        str(node.get("location_label") or ""),
    ]
    return " ".join(fragments).lower()


def score_side(text: str):
    earth_score = sum(1 for token in EARTH_HINTS if token in text)
    moon_score = sum(1 for token in MOON_HINTS if token in text)

    if earth_score == 0 and moon_score == 0:
        return None
    if earth_score > moon_score:
        return "earth"
    if moon_score > earth_score:
        return "moon"
    return None


def is_base_like(node: dict, text: str):
    node_type = str(node.get("node_type") or "")
    if node_type in {"ground_station", "relay"}:
        return True

    # Keep endpoint roles strict: satellite nodes are not treated as base endpoints
    # even if their orbit labels contain words like "relay".
    if node_type == "satellite":
        return False

    label_text = " ".join(
        [
            str(node.get("node_id") or ""),
            str(node.get("location_label") or ""),
        ]
    ).lower()
    return any(token in label_text for token in BASE_HINTS)


def infer_endpoint_groups(nodes: list[dict]):
    earth_base_nodes = []
    moon_base_nodes = []
    earth_any_nodes = []
    moon_any_nodes = []

    for node in nodes:
        node_id = str(node.get("node_id") or "").strip()
        if not node_id:
            continue

        text = node_text(node)
        side = score_side(text)
        if side == "earth":
            earth_any_nodes.append(node_id)
            if is_base_like(node, text):
                earth_base_nodes.append(node_id)
        elif side == "moon":
            moon_any_nodes.append(node_id)
            if is_base_like(node, text):
                moon_base_nodes.append(node_id)

    earth_candidates = earth_base_nodes or earth_any_nodes
    moon_candidates = moon_base_nodes or moon_any_nodes

    return normalize_node_id_list(earth_candidates), normalize_node_id_list(moon_candidates)


def validate_nodes_exist(requested_nodes: list[str], available_nodes: set[str], label: str):
    missing = [node_id for node_id in requested_nodes if node_id not in available_nodes]
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(f"Unknown {label} node(s): {joined}")


def choose_reachable_pair(graph: dict[str, list[str]], sources: list[str], destinations: list[str]):
    random_sources = sources[:]
    random.shuffle(random_sources)

    for source in random_sources:
        reachable = reachable_from(graph, source)
        valid_destinations = [node_id for node_id in destinations if node_id in reachable and node_id != source]
        if not valid_destinations:
            continue
        destination = random.choice(valid_destinations)
        return source, destination

    return None


def make_payload(seq: int, direction: str, source_node: str, destination_node: str):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "kind": "earth-moon-traffic",
        "seq": seq,
        "ts": now,
        "direction": direction,
        "source": source_node,
        "destination": destination_node,
        "trace_id": f"emt-{seq:05d}-{random.randint(1000, 9999)}",
        "metrics": {
            "signal_db": round(random.uniform(1.2, 24.8), 2),
            "queue_depth": random.randint(0, 80),
            "window_expected_s": random.randint(45, 420),
        },
    }


def random_priority():
    # 1 = critical, 2 = high, 3 = bulk
    return random.choices([1, 2, 3], weights=[0.2, 0.5, 0.3], k=1)[0]


def resolve_endpoint_groups(base_url: str, nodes: list[dict], earth_override: list[str], moon_override: list[str]):
    graph = build_graph(nodes)
    available_nodes = set(graph.keys())

    if len(available_nodes) < 2:
        raise RuntimeError("Need at least 2 nodes in /api/nodes before simulation.")

    if earth_override:
        validate_nodes_exist(earth_override, available_nodes, "earth")
        earth_nodes = earth_override
    else:
        earth_nodes, _ = infer_endpoint_groups(nodes)

    if moon_override:
        validate_nodes_exist(moon_override, available_nodes, "moon")
        moon_nodes = moon_override
    else:
        _, moon_nodes = infer_endpoint_groups(nodes)

    if not earth_nodes or not moon_nodes:
        known_nodes = ", ".join(sorted(available_nodes))
        raise RuntimeError(
            "Cannot infer Earth/Moon node groups from metadata. "
            "Use --earth-node and --moon-node to set endpoints explicitly. "
            f"Known nodes: {known_nodes}"
        )

    return graph, earth_nodes, moon_nodes


def main():
    parser = argparse.ArgumentParser(
        description="Generate real Earth<->Moon packet traffic with route hops visible in dashboard."
    )
    parser.add_argument("--api-base-url", default="http://localhost:8001")
    parser.add_argument("--duration", type=float, default=120.0, help="How long to run [seconds].")
    parser.add_argument("--interval", type=float, default=1.2, help="Dispatch interval [seconds].")
    parser.add_argument("--refresh-nodes-every", type=int, default=10, help="Refresh node list every N ticks.")
    parser.add_argument(
        "--earth-node",
        action="append",
        default=[],
        help="Explicit Earth-side endpoint node_id. Can be provided multiple times.",
    )
    parser.add_argument(
        "--moon-node",
        action="append",
        default=[],
        help="Explicit Moon-side endpoint node_id. Can be provided multiple times.",
    )
    args = parser.parse_args()

    base_url = args.api_base_url.rstrip("/")
    earth_override = normalize_node_id_list(args.earth_node)
    moon_override = normalize_node_id_list(args.moon_node)

    tick = 0
    seq = 1
    started = time.monotonic()
    stats = {
        "sent": 0,
        "errors": 0,
        "e2m": 0,
        "m2e": 0,
    }

    try:
        nodes = fetch_nodes(base_url)
        graph, earth_nodes, moon_nodes = resolve_endpoint_groups(base_url, nodes, earth_override, moon_override)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Cannot prepare endpoints from API ({base_url}/api/nodes): {exc}") from exc

    print(
        f"[earth-moon] start base={base_url} duration={args.duration}s interval={args.interval}s "
        f"earth={earth_nodes} moon={moon_nodes}",
        flush=True,
    )

    while time.monotonic() - started < args.duration:
        try:
            if tick % max(args.refresh_nodes_every, 1) == 0:
                nodes = fetch_nodes(base_url)
                graph, earth_nodes, moon_nodes = resolve_endpoint_groups(base_url, nodes, earth_override, moon_override)

            direction = "earth_to_moon" if seq % 2 == 1 else "moon_to_earth"
            if direction == "earth_to_moon":
                pair = choose_reachable_pair(graph, earth_nodes, moon_nodes)
            else:
                pair = choose_reachable_pair(graph, moon_nodes, earth_nodes)

            if pair is None:
                raise RuntimeError(
                    f"No reachable {direction} path found with current links. "
                    "Check /api/nodes links or pass explicit --earth-node/--moon-node values."
                )

            source, destination = pair
            payload = make_payload(seq, direction, source, destination)
            priority = random_priority()

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
                f"[dispatch] #{seq:04d} id={packet_id} dir={direction} prio={priority} "
                f"{source} -> {destination} hops={route}",
                flush=True,
            )

            stats["sent"] += 1
            if direction == "earth_to_moon":
                stats["e2m"] += 1
            else:
                stats["m2e"] += 1
            seq += 1

        except Exception as exc:  # noqa: BLE001
            stats["errors"] += 1
            print(f"[error] {exc}", flush=True)

        tick += 1
        time.sleep(max(args.interval, 0.2))

    print(
        "[earth-moon] done "
        f"sent={stats['sent']} e2m={stats['e2m']} m2e={stats['m2e']} errors={stats['errors']}",
        flush=True,
    )


if __name__ == "__main__":
    main()
