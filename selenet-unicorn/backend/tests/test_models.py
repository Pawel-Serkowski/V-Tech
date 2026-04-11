import pytest
from datetime import datetime, timedelta, timezone
from pydantic import ValidationError
from app.models import ContactWindow, NodeConfig, LinkProfile

def test_contact_window_requires_timezone() -> None:
    naive_start = datetime.now()
    naive_end = naive_start + timedelta(minutes=5)
    with pytest.raises(ValidationError):
        ContactWindow(start=naive_start, end=naive_end)

def test_contact_window_requires_start_before_end() -> None:
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        ContactWindow(start=now, end=now)

def test_link_profile_defaults() -> None:
    link = LinkProfile(dest_node="SAT_A")
    assert link.bandwidth_bps == 1000000
    assert link.windows == []

def test_node_config_deduplicates_and_cleans_links() -> None:
    node = NodeConfig(
        node_id="SAT_A",
        position_x_km=0.0,
        position_y_km=0.0,
        position_z_km=0.0,
        links=[
            LinkProfile(dest_node=" SAT_B "),
            LinkProfile(dest_node="SAT_B"),
            LinkProfile(dest_node="SAT_A"),  # self link
            LinkProfile(dest_node="SAT_C")
        ],
    )
    assert len(node.links) == 2
    assert node.links[0].dest_node == "SAT_B"
    assert node.links[1].dest_node == "SAT_C"

def test_node_config_requires_all_coordinates() -> None:
    with pytest.raises(ValidationError):
        NodeConfig(
            node_id="SAT_A",
            position_x_km=1.0,
            position_y_km=2.0,
        )
