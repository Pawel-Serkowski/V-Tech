"""Tests for dispatch_policy and worker_routing services."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.services.dispatch_policy import resolve_allowed_source_nodes, validate_source_allowed
from app.services.worker_routing import compute_ttl_remaining_seconds, pick_next_hop


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings(
    scope: str = "any",
    node_id: str = "",
    allowed_nodes: list[str] | None = None,
) -> MagicMock:
    s = MagicMock()
    s.dispatch_origin_scope = scope
    s.dispatch_origin_node_id = node_id
    s.allowed_source_nodes = allowed_nodes or []
    return s


def _window() -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "start": (now - timedelta(minutes=5)).isoformat(),
            "end": (now + timedelta(minutes=30)).isoformat(),
        }
    ]


def _node(node_id: str, node_type: str = "satellite", body: str | None = None) -> dict:
    return {
        "node_id": node_id,
        "node_type": node_type,
        "body": body,
        "position_x_km": 10000.0,
        "position_y_km": 0.0,
        "position_z_km": 0.0,
        "links": [],
        "contact_windows": _window(),
    }


# ---------------------------------------------------------------------------
# resolve_allowed_source_nodes
# ---------------------------------------------------------------------------


class TestResolveAllowedSourceNodes:
    def test_scope_any_returns_all_node_ids(self) -> None:
        nodes = [_node("A"), _node("B"), _node("C")]
        settings = _make_settings(scope="any")
        result = resolve_allowed_source_nodes(nodes, settings)
        assert set(result) == {"A", "B", "C"}

    def test_scope_node_returns_only_configured_node(self) -> None:
        nodes = [_node("A"), _node("B")]
        settings = _make_settings(scope="node", node_id="A")
        result = resolve_allowed_source_nodes(nodes, settings)
        assert result == ["A"]

    def test_scope_node_missing_node_returns_empty(self) -> None:
        nodes = [_node("A")]
        settings = _make_settings(scope="node", node_id="MISSING")
        result = resolve_allowed_source_nodes(nodes, settings)
        assert result == []

    def test_scope_satellite_returns_only_satellites(self) -> None:
        nodes = [
            _node("GS_A", node_type="ground_station"),
            _node("SAT_B", node_type="satellite"),
            _node("SAT_C", node_type="satellite"),
        ]
        settings = _make_settings(scope="satellite")
        result = resolve_allowed_source_nodes(nodes, settings)
        assert set(result) == {"SAT_B", "SAT_C"}
        assert "GS_A" not in result

    def test_scope_earth_returns_earth_body_nodes(self) -> None:
        nodes = [
            _node("GS_EARTH", node_type="ground_station", body="earth"),
            _node("GS_MOON", node_type="ground_station", body="moon"),
        ]
        settings = _make_settings(scope="earth")
        result = resolve_allowed_source_nodes(nodes, settings)
        assert result == ["GS_EARTH"]

    def test_scope_moon_returns_moon_body_nodes(self) -> None:
        nodes = [
            _node("GS_EARTH", node_type="ground_station", body="earth"),
            _node("GS_MOON", node_type="ground_station", body="moon"),
        ]
        settings = _make_settings(scope="moon")
        result = resolve_allowed_source_nodes(nodes, settings)
        assert result == ["GS_MOON"]

    def test_explicit_allowed_nodes_override_scope(self) -> None:
        nodes = [_node("A"), _node("B"), _node("C")]
        settings = _make_settings(scope="any", allowed_nodes=["A", "C"])
        result = resolve_allowed_source_nodes(nodes, settings)
        assert set(result) == {"A", "C"}

    def test_explicit_allowed_nodes_filters_nonexistent(self) -> None:
        nodes = [_node("A")]
        settings = _make_settings(scope="any", allowed_nodes=["A", "GHOST"])
        result = resolve_allowed_source_nodes(nodes, settings)
        assert result == ["A"]

    def test_unknown_scope_returns_all_nodes(self) -> None:
        nodes = [_node("X"), _node("Y")]
        settings = _make_settings(scope="unknown_scope")
        result = resolve_allowed_source_nodes(nodes, settings)
        assert set(result) == {"X", "Y"}


# ---------------------------------------------------------------------------
# validate_source_allowed
# ---------------------------------------------------------------------------


class TestValidateSourceAllowed:
    def test_allowed_node_returns_true(self) -> None:
        assert validate_source_allowed("A", ["A", "B"]) is True

    def test_disallowed_node_returns_false(self) -> None:
        assert validate_source_allowed("C", ["A", "B"]) is False

    def test_empty_allowed_list_always_false(self) -> None:
        assert validate_source_allowed("A", []) is False


# ---------------------------------------------------------------------------
# compute_ttl_remaining_seconds
# ---------------------------------------------------------------------------


class TestComputeTtlRemaining:
    def test_fresh_packet_has_near_full_ttl(self) -> None:
        now = datetime.now(timezone.utc)
        earth_ts = (now - timedelta(seconds=10)).isoformat()
        remaining = compute_ttl_remaining_seconds(earth_ts, 3600, now)
        assert 3589 <= remaining <= 3591

    def test_expired_packet_returns_zero(self) -> None:
        now = datetime.now(timezone.utc)
        earth_ts = (now - timedelta(hours=2)).isoformat()
        remaining = compute_ttl_remaining_seconds(earth_ts, 3600, now)
        assert remaining == 0

    def test_invalid_timestamp_returns_full_ttl(self) -> None:
        now = datetime.now(timezone.utc)
        remaining = compute_ttl_remaining_seconds("not-a-date", 3600, now)
        assert remaining == 3600

    def test_timezone_naive_earth_timestamp_handled(self) -> None:
        now = datetime.now(timezone.utc)
        earth_ts = now.replace(tzinfo=None).isoformat()
        remaining = compute_ttl_remaining_seconds(earth_ts, 3600, now)
        # May differ slightly depending on implementation but should not crash
        assert remaining >= 0


# ---------------------------------------------------------------------------
# pick_next_hop
# ---------------------------------------------------------------------------


class TestPickNextHop:
    def test_picks_direct_next_hop(self) -> None:
        now = datetime.now(timezone.utc)
        nodes = [
            {
                "node_id": "SRC",
                "node_type": "ground_station",
                "body": "earth",
                "position_x_km": 6371.0,
                "position_y_km": 0.0,
                "position_z_km": 0.0,
                "links": ["DST"],
                "contact_windows": [
                    {
                        "start": (now - timedelta(minutes=5)).isoformat(),
                        "end": (now + timedelta(hours=1)).isoformat(),
                    }
                ],
            },
            {
                "node_id": "DST",
                "node_type": "satellite",
                "position_x_km": 7000.0,
                "position_y_km": 0.0,
                "position_z_km": 0.0,
                "links": [],
                "contact_windows": [
                    {
                        "start": (now - timedelta(minutes=5)).isoformat(),
                        "end": (now + timedelta(hours=1)).isoformat(),
                    }
                ],
            },
        ]
        hop, route = pick_next_hop("SRC", "DST", nodes, now, 3600, 10)
        assert hop == "DST"
        assert route == ["DST"]

    def test_returns_none_when_ttl_expired(self) -> None:
        now = datetime.now(timezone.utc)
        hop, route = pick_next_hop("SRC", "DST", [], now, ttl_remaining_seconds=0, hop_limit_remaining=10)
        assert hop is None
        assert route == []

    def test_returns_none_when_hop_limit_zero(self) -> None:
        now = datetime.now(timezone.utc)
        hop, route = pick_next_hop("SRC", "DST", [], now, ttl_remaining_seconds=3600, hop_limit_remaining=0)
        assert hop is None
        assert route == []

    def test_returns_none_when_no_route(self) -> None:
        now = datetime.now(timezone.utc)
        nodes = [
            {
                "node_id": "SRC",
                "node_type": "satellite",
                "position_x_km": 10000.0,
                "position_y_km": 0.0,
                "position_z_km": 0.0,
                "links": [],  # no links
                "contact_windows": [
                    {
                        "start": (now - timedelta(minutes=5)).isoformat(),
                        "end": (now + timedelta(hours=1)).isoformat(),
                    }
                ],
            }
        ]
        hop, route = pick_next_hop("SRC", "DST", nodes, now, 3600, 10)
        assert hop is None
