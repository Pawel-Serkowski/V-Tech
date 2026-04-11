"""Extended tests for Pydantic models: PacketCreate, PacketPriority, NodeConfig."""

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.models import (
    ContactWindow,
    NodeConfig,
    PacketCreate,
    PacketPriority,
    PacketStatusUpdate,
)


# ---------------------------------------------------------------------------
# PacketPriority
# ---------------------------------------------------------------------------


def test_packet_priority_rabbit_mapping() -> None:
    assert PacketPriority.CRITICAL.rabbit_priority == 10
    assert PacketPriority.HIGH.rabbit_priority == 6
    assert PacketPriority.BULK.rabbit_priority == 2


def test_packet_priority_values() -> None:
    assert int(PacketPriority.CRITICAL) == 1
    assert int(PacketPriority.HIGH) == 2
    assert int(PacketPriority.BULK) == 3


# ---------------------------------------------------------------------------
# PacketCreate
# ---------------------------------------------------------------------------


def test_packet_create_strips_whitespace_from_nodes() -> None:
    p = PacketCreate(
        source_node="  EARTH_GW  ",
        destination_node="  MOON_GW  ",
        payload={"cmd": "ping"},
    )
    assert p.source_node == "EARTH_GW"
    assert p.destination_node == "MOON_GW"


def test_packet_create_empty_source_node_rejected() -> None:
    with pytest.raises(ValidationError):
        PacketCreate(
            source_node="   ",
            destination_node="MOON_GW",
            payload={},
        )


def test_packet_create_ttl_boundaries() -> None:
    with pytest.raises(ValidationError):
        PacketCreate(
            source_node="A",
            destination_node="B",
            payload={},
            ttl_seconds=59,
        )
    with pytest.raises(ValidationError):
        PacketCreate(
            source_node="A",
            destination_node="B",
            payload={},
            ttl_seconds=86401,
        )


def test_packet_create_hop_limit_boundaries() -> None:
    with pytest.raises(ValidationError):
        PacketCreate(
            source_node="A",
            destination_node="B",
            payload={},
            hop_limit=0,
        )
    with pytest.raises(ValidationError):
        PacketCreate(
            source_node="A",
            destination_node="B",
            payload={},
            hop_limit=51,
        )


def test_packet_create_default_priority_is_bulk() -> None:
    p = PacketCreate(source_node="A", destination_node="B", payload={})
    assert p.priority == PacketPriority.BULK


# ---------------------------------------------------------------------------
# NodeConfig – extended
# ---------------------------------------------------------------------------


def test_node_config_body_copies_from_orbiting_body() -> None:
    node = NodeConfig(
        node_id="SAT_MOON",
        node_type="satellite",
        orbiting_body="moon",
        orbit_altitude_km=100.0,
    )
    assert node.body == "moon"


def test_node_config_full_xyz_accepted() -> None:
    node = NodeConfig(
        node_id="SAT_XYZ",
        position_x_km=1000.0,
        position_y_km=2000.0,
        position_z_km=3000.0,
    )
    assert node.position_x_km == 1000.0


def test_node_config_only_two_xyz_coordinates_rejected() -> None:
    with pytest.raises(ValidationError):
        NodeConfig(
            node_id="SAT_BAD",
            position_x_km=1.0,
            position_z_km=3.0,
        )


def test_node_config_empty_node_id_rejected() -> None:
    with pytest.raises(ValidationError):
        NodeConfig(node_id="   ")


def test_node_config_altitude_without_orbiting_body_rejected() -> None:
    with pytest.raises(ValidationError):
        NodeConfig(node_id="SAT_X", orbit_altitude_km=500.0)


def test_node_config_self_link_removed() -> None:
    node = NodeConfig(node_id="SAT_SELF", links=["SAT_SELF", "SAT_OTHER"])
    assert "SAT_SELF" not in node.links
    assert "SAT_OTHER" in node.links


def test_contact_window_normalised_to_utc() -> None:
    from zoneinfo import ZoneInfo
    tz_berlin = ZoneInfo("Europe/Berlin")
    start = datetime(2026, 1, 1, 12, 0, 0, tzinfo=tz_berlin)
    end = start + timedelta(hours=1)
    window = ContactWindow(start=start, end=end)
    assert window.start.tzinfo.utcoffset(window.start).total_seconds() == 0


# ---------------------------------------------------------------------------
# PacketStatusUpdate
# ---------------------------------------------------------------------------


def test_packet_status_update_all_optional_fields() -> None:
    update = PacketStatusUpdate(
        packet_id="abc-123",
        status="IN_TRANSIT",
        at=datetime.now(timezone.utc),
    )
    assert update.next_hop is None
    assert update.hop_index is None
