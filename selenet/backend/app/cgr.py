from datetime import datetime
from typing import Any


def _to_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _node_has_open_window(node: dict[str, Any], earth_timestamp: datetime) -> bool:
    windows = node.get("contact_windows", [])
    if not windows:
        return False

    for window in windows:
        start = _to_datetime(window.get("start"))
        end = _to_datetime(window.get("end"))
        if start and end and start <= earth_timestamp <= end:
            return True
    return False


class CGREngine:
    @staticmethod
    def compute_next_hop(
        source_node: str,
        destination_node: str,
        nodes: list[dict[str, Any]],
        earth_timestamp: datetime,
    ) -> str | None:
        node_map = {node.get("node_id"): node for node in nodes if node.get("node_id")}
        destination = node_map.get(destination_node)

        # Routing uses Earth baseline time only; time_offset_seconds is retained for visualization.
        if destination and _node_has_open_window(destination, earth_timestamp):
            return destination_node

        candidates: list[dict[str, Any]] = []
        for node in nodes:
            node_id = node.get("node_id")
            if not node_id or node_id == source_node:
                continue
            if _node_has_open_window(node, earth_timestamp):
                candidates.append(node)

        if not candidates:
            return None

        # Ground-station handover preference: route via visible ground stations first.
        candidates.sort(
            key=lambda candidate: (
                0 if candidate.get("node_type") == "ground_station" else 1,
                candidate.get("node_id", ""),
            )
        )
        return candidates[0].get("node_id")