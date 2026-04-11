"""Tests for CGR routing: multi-hop, TTL expiry, hop limit, orbital nodes."""

from datetime import datetime, timedelta, timezone

import pytest

from app.cgr import CGREngine, Position3D, calculate_distance_km, resolve_node_position


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _window(offset_start: int = -5, offset_end: int = 60) -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "start": (now + timedelta(minutes=offset_start)).isoformat(),
            "end": (now + timedelta(minutes=offset_end)).isoformat(),
        }
    ]


def _sat(node_id: str, x: float, y: float, z: float, links: list[str]) -> dict:
    return {
        "node_id": node_id,
        "node_type": "satellite",
        "position_x_km": x,
        "position_y_km": y,
        "position_z_km": z,
        "links": links,
        "contact_windows": _window(),
    }


def _gs(node_id: str, x: float, y: float, z: float, body: str, links: list[str]) -> dict:
    return {
        "node_id": node_id,
        "node_type": "ground_station",
        "body": body,
        "position_x_km": x,
        "position_y_km": y,
        "position_z_km": z,
        "links": links,
        "contact_windows": _window(),
    }


# ---------------------------------------------------------------------------
# Position3D dataclass
# ---------------------------------------------------------------------------


def test_position3d_as_tuple() -> None:
    p = Position3D(1.0, 2.0, 3.0)
    assert p.as_tuple() == (1.0, 2.0, 3.0)


# ---------------------------------------------------------------------------
# resolve_node_position
# ---------------------------------------------------------------------------


def test_resolve_position_from_cartesian() -> None:
    node = {"position_x_km": 100.0, "position_y_km": 200.0, "position_z_km": 300.0}
    pos = resolve_node_position(node, current_time_ts=0.0)
    assert pos is not None
    assert pos.x == 100.0


def test_resolve_position_returns_none_for_no_info() -> None:
    node = {"node_id": "GHOST"}
    pos = resolve_node_position(node, current_time_ts=0.0)
    assert pos is None


def test_resolve_position_surface_node() -> None:
    node = {
        "node_id": "GS_EQUATOR",
        "body": "earth",
        "surface_lat_deg": 0.0,
        "surface_lon_deg": 0.0,
    }
    pos = resolve_node_position(node, current_time_ts=0.0)
    assert pos is not None
    # At equator/prime meridian the X position should match Earth's radius (~6371 km)
    assert abs(pos.x - 6371.0) < 100.0
    assert abs(pos.y) < 1.0
    assert abs(pos.z) < 1.0


# ---------------------------------------------------------------------------
# calculate_distance_km
# ---------------------------------------------------------------------------


def test_distance_km_between_known_coords() -> None:
    a = {"position_x_km": 0.0, "position_y_km": 0.0, "position_z_km": 0.0}
    b = {"position_x_km": 3.0, "position_y_km": 4.0, "position_z_km": 0.0}
    dist = calculate_distance_km(a, b)
    assert dist is not None
    assert abs(dist - 5.0) < 1e-6


def test_distance_km_none_when_position_missing() -> None:
    a = {"node_id": "A"}
    b = {"node_id": "B"}
    dist = calculate_distance_km(a, b)
    assert dist is None


# ---------------------------------------------------------------------------
# CGREngine.compute_route_hops – core cases
# ---------------------------------------------------------------------------


def test_cgr_same_source_and_destination() -> None:
    nodes = [_gs("A", 6371.0, 0.0, 0.0, "earth", [])]
    result = CGREngine.compute_route_hops("A", "A", nodes, datetime.now(timezone.utc))
    assert result == []


def test_cgr_unknown_source_returns_none() -> None:
    nodes = [_gs("B", 6371.0, 0.0, 0.0, "earth", [])]
    result = CGREngine.compute_route_hops("MISSING", "B", nodes, datetime.now(timezone.utc))
    assert result is None


def test_cgr_unknown_destination_returns_none() -> None:
    nodes = [_gs("A", 6371.0, 0.0, 0.0, "earth", [])]
    result = CGREngine.compute_route_hops("A", "MISSING", nodes, datetime.now(timezone.utc))
    assert result is None


def test_cgr_direct_link_single_hop() -> None:
    nodes = [
        _gs("SRC", 6371.0, 0.0, 0.0, "earth", ["DST"]),
        _sat("DST", 6471.0, 0.0, 0.0, []),
    ]
    result = CGREngine.compute_route_hops("SRC", "DST", nodes, datetime.now(timezone.utc))
    assert result == ["DST"]


def test_cgr_two_hop_route() -> None:
    nodes = [
        _gs("SRC", 6371.0, 0.0, 0.0, "earth", ["MID"]),
        _sat("MID", 20000.0, 0.0, 0.0, ["DST"]),
        _sat("DST", 40000.0, 0.0, 0.0, []),
    ]
    result = CGREngine.compute_route_hops("SRC", "DST", nodes, datetime.now(timezone.utc))
    assert result == ["MID", "DST"]


def test_cgr_no_route_when_no_link() -> None:
    nodes = [
        _gs("SRC", 6371.0, 0.0, 0.0, "earth", []),
        _sat("DST", 20000.0, 0.0, 0.0, []),
    ]
    result = CGREngine.compute_route_hops("SRC", "DST", nodes, datetime.now(timezone.utc))
    assert result is None


def test_cgr_hop_limit_blocks_route() -> None:
    nodes = [
        _gs("SRC", 6371.0, 0.0, 0.0, "earth", ["HOP1"]),
        _sat("HOP1", 10000.0, 0.0, 0.0, ["HOP2"]),
        _sat("HOP2", 18000.0, 0.0, 0.0, ["DST"]),
        _sat("DST", 26000.0, 0.0, 0.0, []),
    ]
    result = CGREngine.compute_route_hops(
        "SRC", "DST", nodes, datetime.now(timezone.utc), hop_limit=2
    )
    # 3 hops needed, limit is 2 – should fail
    assert result is None


def test_cgr_expired_contact_window_blocks_route() -> None:
    now = datetime.now(timezone.utc)
    past_window = [
        {
            "start": (now - timedelta(hours=2)).isoformat(),
            "end": (now - timedelta(hours=1)).isoformat(),
        }
    ]
    nodes = [
        {
            "node_id": "SRC",
            "node_type": "ground_station",
            "body": "earth",
            "position_x_km": 6371.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["DST"],
            "contact_windows": past_window,
        },
        _sat("DST", 20000.0, 0.0, 0.0, []),
    ]
    result = CGREngine.compute_route_hops("SRC", "DST", nodes, now)
    assert result is None


def test_cgr_prefers_shorter_path() -> None:
    """Two routes: direct but long-delay vs 2-hop but shorter distance – CGR picks lower total delay."""
    nodes = [
        _gs("SRC", 6371.0, 0.0, 0.0, "earth", ["LONG_SAT", "RELAY"]),
        _sat("LONG_SAT", 400000.0, 0.0, 0.0, ["DST"]),  # very far
        _sat("RELAY", 20000.0, 0.0, 0.0, ["DST"]),      # closer relay
        _sat("DST", 26000.0, 0.0, 0.0, []),
    ]
    result = CGREngine.compute_route_hops("SRC", "DST", nodes, datetime.now(timezone.utc))
    assert result is not None
    assert "RELAY" in result


def test_cgr_avoids_cycle() -> None:
    """A→B→A→B would be a cycle; CGR must not loop."""
    nodes = [
        _sat("A", 6371.0, 0.0, 0.0, ["B"]),
        _sat("B", 7000.0, 0.0, 0.0, ["A", "C"]),
        _sat("C", 8000.0, 0.0, 0.0, []),
    ]
    result = CGREngine.compute_route_hops("A", "C", nodes, datetime.now(timezone.utc))
    assert result == ["B", "C"]
