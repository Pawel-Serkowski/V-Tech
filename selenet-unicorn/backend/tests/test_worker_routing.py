from datetime import datetime, timedelta, timezone

from app.services.worker_routing import compute_ttl_remaining_seconds, pick_next_hop


def _window_for_now() -> list[dict[str, str]]:
    now = datetime.now(timezone.utc)
    return [
        {
            "start": (now - timedelta(minutes=5)).isoformat(),
            "end": (now + timedelta(minutes=15)).isoformat(),
        }
    ]


def test_compute_ttl_remaining_seconds_decreases_with_time() -> None:
    now = datetime.now(timezone.utc)
    earth_timestamp = (now - timedelta(seconds=40)).isoformat()

    ttl_remaining = compute_ttl_remaining_seconds(
        earth_timestamp_iso=earth_timestamp,
        ttl_seconds=100,
        now=now,
    )

    assert 59 <= ttl_remaining <= 60


def test_pick_next_hop_uses_cgr_shortest_path() -> None:
    now = datetime.now(timezone.utc)

    nodes = [
        {
            "node_id": "EARTH_GATEWAY",
            "node_type": "ground_station",
            "body": "earth",
            "position_x_km": 6371.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["SAT_FAST", "SAT_SLOW"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "SAT_FAST",
            "node_type": "satellite",
            "position_x_km": 70000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["MOON_BASE"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "SAT_SLOW",
            "node_type": "satellite",
            "position_x_km": 10000.0,
            "position_y_km": 150000.0,
            "position_z_km": 0.0,
            "links": ["MOON_BASE"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "MOON_BASE",
            "node_type": "ground_station",
            "body": "moon",
            "position_x_km": 386137.4,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": [],
            "contact_windows": _window_for_now(),
        },
    ]

    next_hop, route = pick_next_hop(
        current_node="EARTH_GATEWAY",
        destination_node="MOON_BASE",
        nodes=nodes,
        now=now,
        ttl_remaining_seconds=1200,
        hop_limit_remaining=8,
    )

    assert next_hop == "SAT_FAST"
    assert route[-1] == "MOON_BASE"
