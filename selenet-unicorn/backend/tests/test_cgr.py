import pytest
from datetime import datetime, timedelta, timezone
from app.cgr import CGREngine, calculate_link_delays

@pytest.fixture
def sample_contact_plan():
    now = datetime.now(timezone.utc)
    return [
        {
            "source": "EARTH",
            "dest": "SAT_1",
            "bandwidth_bps": 1000000,
            "windows": [
                {
                    "start": (now - timedelta(minutes=5)).isoformat(),
                    "end": (now + timedelta(minutes=15)).isoformat(),
                    "avg_range_km": 1000.0
                }
            ]
        },
        {
            "source": "SAT_1",
            "dest": "MOON",
            "bandwidth_bps": 500000,
            "windows": [
                {
                    "start": (now - timedelta(minutes=5)).isoformat(),
                    "end": (now + timedelta(minutes=15)).isoformat(),
                    "avg_range_km": 380000.0
                }
            ]
        }
    ]

def test_calculate_link_delays() -> None:
    # 1000 bytes = 8000 bits. Bandwidth = 1000 bps -> 8 seconds transmission.
    # Range = 300,000 km -> ~1 second propagation delay
    prop, trans = calculate_link_delays(
        packet_size_bytes=1000, 
        bandwidth_bps=1000, 
        range_km=300000.0
    )
    assert abs(trans - 8.0) < 0.1
    assert abs(prop - 1.0) < 0.1

def test_cgr_computes_valid_route(sample_contact_plan) -> None:
    now = datetime.now(timezone.utc)
    route = CGREngine.compute_route_hops(
        source_node="EARTH",
        destination_node="MOON",
        contact_plan=sample_contact_plan,
        earth_timestamp=now,
        packet_size_bytes=1024,
        ttl_seconds=3600,
        hop_limit=5
    )
    assert route == ["SAT_1", "MOON"]

def test_cgr_fails_if_no_valid_path(sample_contact_plan) -> None:
    now = datetime.now(timezone.utc)
    route = CGREngine.compute_route_hops(
        source_node="EARTH",
        destination_node="MARS",
        contact_plan=sample_contact_plan,
        earth_timestamp=now,
        packet_size_bytes=1024,
        ttl_seconds=3600,
        hop_limit=5
    )
    assert route is None

def test_cgr_fails_if_ttl_exceeded(sample_contact_plan) -> None:
    now = datetime.now(timezone.utc)
    # Give it 0 TTL so it drops immediately
    route = CGREngine.compute_route_hops(
        source_node="EARTH",
        destination_node="MOON",
        contact_plan=sample_contact_plan,
        earth_timestamp=now,
        packet_size_bytes=1024,
        ttl_seconds=0,
        hop_limit=5
    )
    assert route is None
