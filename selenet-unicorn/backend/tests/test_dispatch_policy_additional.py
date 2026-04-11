from app.config import Settings
from app.services.dispatch_policy import resolve_allowed_source_nodes, validate_source_allowed


NODES = [
    {"node_id": "EARTH_A", "body": "earth", "node_type": "ground_station"},
    {"node_id": "MOON_A", "body": "moon", "node_type": "ground_station"},
    {"node_id": "SAT_A", "body": "deep_space", "node_type": "satellite"},
    {"node_id": "RELAY_A", "body": "earth", "node_type": "relay"},
]


def test_dispatch_policy_any_scope_allows_all_nodes_sorted() -> None:
    settings = Settings(dispatch_origin_scope="any")

    allowed = resolve_allowed_source_nodes(NODES, settings)

    assert allowed == ["EARTH_A", "MOON_A", "RELAY_A", "SAT_A"]


def test_dispatch_policy_satellite_scope_filters_by_node_type() -> None:
    settings = Settings(dispatch_origin_scope="satellite")

    allowed = resolve_allowed_source_nodes(NODES, settings)

    assert allowed == ["SAT_A"]


def test_dispatch_policy_node_scope_uses_configured_node() -> None:
    settings = Settings(dispatch_origin_scope="node", dispatch_origin_node_id="MOON_A")

    allowed = resolve_allowed_source_nodes(NODES, settings)

    assert allowed == ["MOON_A"]
    assert validate_source_allowed("MOON_A", allowed)


def test_dispatch_policy_node_scope_returns_empty_if_missing() -> None:
    settings = Settings(dispatch_origin_scope="node", dispatch_origin_node_id="UNKNOWN")

    allowed = resolve_allowed_source_nodes(NODES, settings)

    assert allowed == []
