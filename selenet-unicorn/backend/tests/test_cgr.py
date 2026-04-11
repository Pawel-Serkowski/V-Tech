from datetime import datetime, timedelta, timezone

from app.cgr import CGREngine


def _window_for_now() -> list[dict[str, str]]:
    now = datetime.now(timezone.utc)
    return [
        {
            "start": (now - timedelta(minutes=5)).isoformat(),
            "end": (now + timedelta(minutes=15)).isoformat(),
        }
    ]


def test_cgr_blocks_route_through_earth() -> None:
    now = datetime.now(timezone.utc)

    nodes = [
        {
            "node_id": "EARTH_WEST",
            "node_type": "ground_station",
            "body": "earth",
            "surface_lat_deg": 0.0,
            "surface_lon_deg": 0.0,
            "links": ["EARTH_EAST"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "EARTH_EAST",
            "node_type": "ground_station",
            "body": "earth",
            "surface_lat_deg": 0.0,
            "surface_lon_deg": 180.0,
            "links": ["EARTH_WEST"],
            "contact_windows": _window_for_now(),
        },
    ]

    route = CGREngine.compute_route_hops(
        source_node="EARTH_WEST",
        destination_node="EARTH_EAST",
        nodes=nodes,
        earth_timestamp=now,
        ttl_seconds=900,
        hop_limit=5,
    )

    assert route is None


def test_cgr_prefers_fastest_satellite_path() -> None:
    now = datetime.now(timezone.utc)

    nodes = [
        {
            "node_id": "EARTH_GATEWAY",
            "node_type": "ground_station",
            "body": "earth",
            "position_x_km": 6371.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["SAT_RELAY", "EARTH_BACKHAUL"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "EARTH_BACKHAUL",
            "node_type": "ground_station",
            "body": "earth",
            "position_x_km": -6371.0,
            "position_y_km": 0.0,
            "position_z_km": 0.0,
            "links": ["MOON_BASE"],
            "contact_windows": _window_for_now(),
        },
        {
            "node_id": "SAT_RELAY",
            "node_type": "satellite",
            "position_x_km": 70000.0,
            "position_y_km": 0.0,
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

    route = CGREngine.compute_route_hops(
        source_node="EARTH_GATEWAY",
        destination_node="MOON_BASE",
        nodes=nodes,
        earth_timestamp=now,
        ttl_seconds=900,
        hop_limit=6,
    )

    assert route is not None
    assert route[0] == "SAT_RELAY"
    assert route[-1] == "MOON_BASE"
