from datetime import datetime, timedelta, timezone

from app.cgr import CGREngine, compute_hop_delay_seconds, line_of_sight_clear, resolve_node_position


def _window_for_now() -> list[dict[str, str]]:
    now = datetime.now(timezone.utc)
    return [
        {
            "start": (now - timedelta(minutes=5)).isoformat(),
            "end": (now + timedelta(minutes=15)).isoformat(),
        }
    ]


def test_cgr_returns_empty_route_when_source_equals_destination() -> None:
    now = datetime.now(timezone.utc)
    nodes = [
        {"node_id": "A", "links": ["B"], "contact_windows": _window_for_now()},
        {"node_id": "B", "links": [], "contact_windows": _window_for_now()},
    ]

    route = CGREngine.compute_route_hops("A", "A", nodes, now, ttl_seconds=100, hop_limit=3)
    assert route == []


def test_cgr_returns_none_for_unknown_destination() -> None:
    now = datetime.now(timezone.utc)
    nodes = [{"node_id": "A", "links": [], "contact_windows": _window_for_now()}]

    route = CGREngine.compute_route_hops("A", "Z", nodes, now)
    assert route is None


def test_cgr_respects_hop_limit() -> None:
    now = datetime.now(timezone.utc)
    nodes = [
        {
            "node_id": "SRC",
            "position_x_km": 7000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["MID"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "MID",
            "position_x_km": 60000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["DST"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "DST",
            "position_x_km": 380000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": [],
            "contact_windows": _window_for_now(),
        },
    ]

    route = CGREngine.compute_route_hops("SRC", "DST", nodes, now, ttl_seconds=1000, hop_limit=1)
    assert route is None


def test_cgr_respects_ttl_deadline() -> None:
    now = datetime.now(timezone.utc)
    nodes = [
        {
            "node_id": "SRC",
            "position_x_km": 1000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["DST"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "DST",
            "position_x_km": 3_100_000.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": [],
            "contact_windows": _window_for_now(),
        },
    ]

    route = CGREngine.compute_route_hops("SRC", "DST", nodes, now, ttl_seconds=1, hop_limit=3)
    assert route is None


def test_resolve_node_position_supports_orbital_and_surface_modes() -> None:
    orbital = {
        "node_id": "SAT_A",
        "orbiting_body": "earth",
        "orbit_altitude_km": 500.0,
        "orbital_phase_deg": 0.0,
        "orbital_inclination_deg": 0.0,
    }
    surface = {
        "node_id": "GS_A",
        "body": "earth",
        "surface_lat_deg": 0.0,
        "surface_lon_deg": 0.0,
    }

    sat_pos = resolve_node_position(orbital, current_time_ts=0.0)
    gs_pos = resolve_node_position(surface, current_time_ts=0.0)

    assert sat_pos is not None
    assert gs_pos is not None
    assert sat_pos.x > gs_pos.x


def test_line_of_sight_allows_entering_destination_body() -> None:
    source = {
        "node_id": "SAT_A",
        "position_x_km": 70000.0,
        "position_y_km": 0.0,
        "position_z_km": 0.0,
    }
    destination = {
        "node_id": "EARTH_GS",
        "body": "earth",
        "position_x_km": 6371.0,
        "position_y_km": 0.0,
        "position_z_km": 0.0,
    }

    assert line_of_sight_clear(source, destination)


def test_compute_hop_delay_uses_fallback_for_unknown_node() -> None:
    nodes = [{"node_id": "A", "links": []}]

    delay = compute_hop_delay_seconds("A", "B", nodes)
    assert delay == 1.0
