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


def test_compute_ttl_remaining_with_invalid_timestamp_returns_full_ttl() -> None:
    now = datetime.now(timezone.utc)

    ttl_remaining = compute_ttl_remaining_seconds("not-a-date", 77, now)

    assert ttl_remaining == 77


def test_pick_next_hop_returns_none_when_ttl_is_zero() -> None:
    now = datetime.now(timezone.utc)

    next_hop, route = pick_next_hop(
        current_node="A",
        destination_node="B",
        nodes=[],
        now=now,
        ttl_remaining_seconds=0,
        hop_limit_remaining=3,
    )

    assert next_hop is None
    assert route == []


def test_pick_next_hop_returns_none_when_hop_limit_is_zero() -> None:
    now = datetime.now(timezone.utc)

    next_hop, route = pick_next_hop(
        current_node="A",
        destination_node="B",
        nodes=[],
        now=now,
        ttl_remaining_seconds=10,
        hop_limit_remaining=0,
    )

    assert next_hop is None
    assert route == []


def test_pick_next_hop_returns_none_when_no_route_available() -> None:
    now = datetime.now(timezone.utc)
    nodes = [
        {
            "node_id": "A",
            "position_x_km": 7000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": [],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "B",
            "position_x_km": 8000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": [],
            "contact_windows": _window_for_now(),
        },
    ]

    next_hop, route = pick_next_hop(
        current_node="A",
        destination_node="B",
        nodes=nodes,
        now=now,
        ttl_remaining_seconds=30,
        hop_limit_remaining=5,
    )

    assert next_hop is None
    assert route == []
