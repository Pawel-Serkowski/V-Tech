from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.models import ContactWindow, NodeConfig


def test_contact_window_requires_timezone() -> None:
    naive_start = datetime.now(timezone.utc).replace(tzinfo=None)
    naive_end = naive_start + timedelta(minutes=5)

    with pytest.raises(ValidationError):
        ContactWindow(start=naive_start, end=naive_end)


def test_contact_window_requires_start_before_end() -> None:
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        ContactWindow(start=now, end=now)


def test_node_config_deduplicates_and_cleans_links() -> None:
    node = NodeConfig(
        node_id="SAT_A",
        links=[" SAT_B ", "SAT_B", "", "SAT_A", "SAT_C"],
    )

    assert node.links == ["SAT_B", "SAT_C"]


def test_node_config_requires_full_xyz_triplet() -> None:
    with pytest.raises(ValidationError):
        NodeConfig(
            node_id="SAT_A",
            position_x_km=1.0,
            position_y_km=2.0,
        )


def test_node_config_requires_orbiting_body_when_altitude_set() -> None:
    with pytest.raises(ValidationError):
        NodeConfig(
            node_id="SAT_A",
            orbit_altitude_km=1500.0,
        )


def test_node_config_requires_surface_lat_lon_pair() -> None:
    with pytest.raises(ValidationError):
        NodeConfig(
            node_id="EARTH_A",
            body="earth",
            surface_lat_deg=10.0,
        )


def test_ground_station_defaults_body_to_earth() -> None:
    node = NodeConfig(
        node_id="GS_A",
        node_type="ground_station",
    )

    assert node.body == "earth"
