from datetime import datetime, timezone
import heapq
import math
from typing import Any


SPEED_OF_LIGHT_KM_S = 299792.458


def _extract_cartesian_position(node: dict[str, Any]) -> tuple[float, float, float] | None:
    x = node.get("position_x_km")
    y = node.get("position_y_km")
    z = node.get("position_z_km")

    if x is None or y is None or z is None:
        return None

    try:
        return (float(x), float(y), float(z))
    except (TypeError, ValueError):
        return None


def calculate_distance(source_node: dict[str, Any], destination_node: dict[str, Any]) -> float | None:
    source_position = _extract_cartesian_position(source_node)
    destination_position = _extract_cartesian_position(destination_node)

    if not source_position or not destination_position:
        return None

    return math.dist(source_position, destination_position)


def calculate_delay(
    source_node: dict[str, Any],
    destination_node_id: str,
    node_map: dict[str, dict[str, Any]],
) -> float:
    destination_node = node_map.get(destination_node_id)
    if destination_node is not None:
        distance_km = calculate_distance(source_node, destination_node)
        if distance_km is not None:
            return distance_km / SPEED_OF_LIGHT_KM_S

    source_type = source_node.get("node_type")
    if source_type == "ground_station":
        return 0.5
    if source_type == "relay":
        return 1.5
    return 2.0

def _build_contacts_for_nodes(nodes, current_time, node_map):
    contact_plan = []
    for node in nodes:
        for window in node.get("contact_windows", []):
            start = _to_datetime(window.get("start"))
            end = _to_datetime(window.get("end"))

            if not start or not end or end < current_time:
                continue

            neighbors = _collect_neighbors(node.get("node_id"), node_map)
            for neighbor in neighbors:
                contact_plan.append({
                    "source": node.get("node_id"),
                    "dest": neighbor,
                    "start": start,
                    "end": end,
                    "delay": calculate_delay(node, neighbor, node_map)
                })
    
    contact_plan.sort(key=lambda x: x["start"])
    return contact_plan


def _to_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
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
        ttl_seconds: int = 3600,
        hop_limit: int = 10
    ) -> list[str] | None:
        node_map = {node.get("node_id"): node for node in nodes}
        plan = _build_contacts_for_nodes(nodes, earth_timestamp, node_map)
        plan_by_source = {}

        deadline = earth_timestamp.timestamp() + ttl_seconds

        for contact in plan:
            contact_source_node = contact["source"]
            if contact_source_node not in plan_by_source:
                plan_by_source[contact_source_node] = []
            plan_by_source[contact_source_node].append(contact)
        

        earliest_arrival = {}
        for node in nodes:
            earliest_arrival[node.get("node_id")] = float('inf')
        earliest_arrival[source_node] = earth_timestamp.timestamp()

        priority_queue = [(earth_timestamp.timestamp(), source_node, [])] #czas przybycia, aktualny węzeł, ścieżka
        while priority_queue:
            current_time, current_node, path = heapq.heappop(priority_queue)

            if len(path) >= hop_limit:
                continue
        
            if current_time > deadline:
                continue

            if current_time > earliest_arrival[current_node]: #jeżeli do sprawdzanego węzła już jest gdzies szybsza droga
                continue
            
            if current_node == destination_node:
                return path
            
            for contact in plan_by_source.get(current_node, []):
                if contact["source"] == current_node:
                    if contact["dest"] in path:
                        continue #avoiding loop 
                
                    #wysyłanie nie wcześniej niż pakiet dotrze i nie wcześniej niż dane okienko będzie dostepne
                    start_send_time = max(current_time, contact["start"].timestamp())

                    #czy pakiet dojdzie przed zamknięciem okna
                    if start_send_time + contact["delay"] <= contact["end"].timestamp():
                        arrival_time_to_dest = start_send_time + contact["delay"]

                        if arrival_time_to_dest < earliest_arrival[contact["dest"]]:
                            earliest_arrival[contact["dest"]] = arrival_time_to_dest
                            heapq.heappush(priority_queue, (arrival_time_to_dest, contact["dest"], path + [contact["dest"]]))

        return None
