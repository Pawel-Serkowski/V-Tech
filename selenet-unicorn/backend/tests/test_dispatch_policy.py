from app.config import Settings
from app.services.dispatch_policy import resolve_allowed_source_nodes, validate_source_allowed


def test_dispatch_policy_earth_scope_allows_only_earth_nodes() -> None:
    settings = Settings(dispatch_origin_scope="earth")
    nodes = [
        {"node_id": "EARTH_A", "body": "earth", "node_type": "ground_station"},
        {"node_id": "MOON_A", "body": "moon", "node_type": "ground_station"},
        {"node_id": "SAT_A", "body": "deep_space", "node_type": "satellite"},
    ]

    allowed = resolve_allowed_source_nodes(nodes, settings)

    assert allowed == ["EARTH_A"]
    assert validate_source_allowed("EARTH_A", allowed)
    assert not validate_source_allowed("MOON_A", allowed)


def test_dispatch_policy_explicit_allow_list_has_priority() -> None:
    settings = Settings(
        dispatch_origin_scope="earth",
        dispatch_allowed_source_node_ids="MOON_A,SAT_A",
    )
    nodes = [
        {"node_id": "EARTH_A", "body": "earth", "node_type": "ground_station"},
        {"node_id": "MOON_A", "body": "moon", "node_type": "ground_station"},
        {"node_id": "SAT_A", "body": "deep_space", "node_type": "satellite"},
    ]

    allowed = resolve_allowed_source_nodes(nodes, settings)

    assert allowed == ["MOON_A", "SAT_A"]
