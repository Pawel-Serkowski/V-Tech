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


def _node_sort_key(node: dict[str, Any]) -> tuple[int, str]:
    return (
        0 if node.get("node_type") == "ground_station" else 1,
        node.get("node_id", ""),
    )


def _collect_neighbors(
    current_node_id: str,
    node_map: dict[str, dict[str, Any]],
) -> list[str]:
    current_node = node_map.get(current_node_id)

    if current_node is not None:
        if "links" in current_node:
            links = current_node.get("links") or []
            linked_neighbors = [
                item.strip()
                for item in links
                if isinstance(item, str)
                and item.strip()
                and item.strip() != current_node_id
                and item.strip() in node_map
            ]
            return sorted(linked_neighbors, key=lambda node_id: _node_sort_key(node_map[node_id]))

    # Backward-compatible fallback: if no explicit links are configured,
    # consider all known nodes as potential neighbors.
    return sorted(
        [node_id for node_id in node_map if node_id != current_node_id],
        key=lambda node_id: _node_sort_key(node_map[node_id]),
    )


class CGREngine:
    @staticmethod
    def compute_route_hops(
        source_node: str,
        destination_node: str,
        nodes: list[dict[str, Any]],
        earth_timestamp: datetime,
    ) -> list[str] | None:
        node_map = {node.get("node_id"): node for node in nodes if node.get("node_id")}
        destination = node_map.get(destination_node)

        if destination is None:
            return None

        # Routing uses Earth baseline time only; time_offset_seconds is retained for visualization.
        visible_nodes = {
            node_id
            for node_id, node in node_map.items()
            if _node_has_open_window(node, earth_timestamp)
        }
        if destination_node not in visible_nodes:
            return None

        # Fast path for direct transfer.
        if source_node != destination_node and destination_node in visible_nodes:
            source_neighbors = _collect_neighbors(source_node, node_map)
            if destination_node in source_neighbors:
                return [destination_node]

        # Breadth-first search across currently visible nodes.
        queue: list[tuple[str, list[str]]] = [(source_node, [])]
        visited: set[str] = {source_node}

        while queue:
            current_node_id, path = queue.pop(0)
            neighbors = _collect_neighbors(current_node_id, node_map)

            for neighbor_id in neighbors:
                if neighbor_id in visited:
                    continue
                if neighbor_id not in visible_nodes:
                    continue

                next_path = [*path, neighbor_id]
                if neighbor_id == destination_node:
                    return next_path

                visited.add(neighbor_id)
                queue.append((neighbor_id, next_path))

        return None

    @staticmethod
    def compute_next_hop(
        source_node: str,
        destination_node: str,
        nodes: list[dict[str, Any]],
        earth_timestamp: datetime,
    ) -> str | None:
        route_hops = CGREngine.compute_route_hops(
            source_node=source_node,
            destination_node=destination_node,
            nodes=nodes,
            earth_timestamp=earth_timestamp,
        )
        if not route_hops:
            return None
        return route_hops[0]
