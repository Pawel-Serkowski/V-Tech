from typing import Any

from app.config import Settings


def resolve_allowed_source_nodes(
    nodes: list[dict[str, Any]],
    settings: Settings,
) -> list[str]:
    node_ids = {
        node.get("node_id")
        for node in nodes
        if isinstance(node.get("node_id"), str)
    }

    if settings.allowed_source_nodes:
        return [node_id for node_id in settings.allowed_source_nodes if node_id in node_ids]

    scope = settings.dispatch_origin_scope
    if scope == "any":
        return sorted(node_ids)

    if scope == "node":
        configured = settings.dispatch_origin_node_id.strip()
        if configured and configured in node_ids:
            return [configured]
        return []

    if scope == "satellite":
        return sorted(
            node["node_id"]
            for node in nodes
            if isinstance(node.get("node_id"), str) and node.get("node_type") == "satellite"
        )

    if scope in {"earth", "moon"}:
        return sorted(
            node["node_id"]
            for node in nodes
            if isinstance(node.get("node_id"), str)
            and str(node.get("body", "")).lower() == scope
        )

    return sorted(node_ids)


def validate_source_allowed(
    source_node: str,
    allowed_sources: list[str],
) -> bool:
    return source_node in set(allowed_sources)
