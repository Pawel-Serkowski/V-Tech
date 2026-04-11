from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import heapq
import math
from typing import Any

from app.config import get_settings

SPEED_OF_LIGHT_KM_S = 299792.458
TIME_EPSILON = 1e-9
DISTANCE_EPSILON = 1e-6


@dataclass(slots=True)
class ContactOpportunity:
    source: str
    destination: str
    start_ts: float
    end_ts: float
    delay_seconds: float
    distance_km: float


@dataclass(slots=True)
class Position3D:
    x: float
    y: float
    z: float

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.x, self.y, self.z)


class CGREngine:
    @staticmethod
    def compute_route_hops(
        source_node: str,
        destination_node: str,
        nodes: list[dict[str, Any]],
        earth_timestamp: datetime,
        ttl_seconds: int = 3600,
        hop_limit: int = 10,
    ) -> list[str] | None:
        source = source_node.strip()
        destination = destination_node.strip()

        if not source or not destination:
            return None
        if source == destination:
            return []

        if earth_timestamp.tzinfo is None or earth_timestamp.tzinfo.utcoffset(earth_timestamp) is None:
            earth_timestamp = earth_timestamp.replace(tzinfo=timezone.utc)
        else:
            earth_timestamp = earth_timestamp.astimezone(timezone.utc)

        node_map = {
            node.get("node_id"): node
            for node in nodes
            if isinstance(node.get("node_id"), str)
        }

        if source not in node_map or destination not in node_map:
            return None

        start_ts = earth_timestamp.timestamp()
        deadline = start_ts + max(1, int(ttl_seconds))

        best_metrics: dict[str, tuple[float, float, int]] = {source: (start_ts, 0.0, 0)}
        priority_queue: list[tuple[float, float, int, str, list[str]]] = [
            (start_ts, 0.0, 0, source, [])
        ]

        while priority_queue:
            arrival_ts, total_distance, hops_used, current_node, path = heapq.heappop(priority_queue)

            best_for_current = best_metrics.get(current_node)
            if best_for_current and _is_strictly_worse(
                (arrival_ts, total_distance, hops_used),
                best_for_current,
            ):
                continue

            if arrival_ts > deadline + TIME_EPSILON:
                continue

            if current_node == destination:
                return path

            if hops_used >= hop_limit:
                continue

            contacts = _build_contacts_for_source(
                source_node_id=current_node,
                node_map=node_map,
                current_time_ts=arrival_ts,
                deadline_ts=deadline,
            )

            for contact in contacts:
                if contact.destination in path:
                    continue

                send_ts = max(arrival_ts, contact.start_ts)
                target_arrival_ts = send_ts + contact.delay_seconds

                if target_arrival_ts > contact.end_ts + TIME_EPSILON:
                    continue
                if target_arrival_ts > deadline + TIME_EPSILON:
                    continue

                candidate_path = [*path, contact.destination]
                candidate_hops_used = hops_used + 1
                candidate_distance = total_distance + contact.distance_km
                candidate_metrics = (
                    target_arrival_ts,
                    candidate_distance,
                    candidate_hops_used,
                )

                previous_best = best_metrics.get(contact.destination)
                if previous_best is None or _is_better(candidate_metrics, previous_best):
                    best_metrics[contact.destination] = candidate_metrics
                    heapq.heappush(
                        priority_queue,
                        (
                            candidate_metrics[0],
                            candidate_metrics[1],
                            candidate_metrics[2],
                            contact.destination,
                            candidate_path,
                        ),
                    )

        return None


def compute_hop_delay_seconds(
    source_node_id: str,
    destination_node_id: str,
    nodes: list[dict[str, Any]],
) -> float:
    node_map = {
        node.get("node_id"): node
        for node in nodes
        if isinstance(node.get("node_id"), str)
    }
    source = node_map.get(source_node_id)
    destination = node_map.get(destination_node_id)
    if not source or not destination:
        return 1.0

    distance = calculate_distance_km(source, destination)
    if distance is None:
        return _heuristic_delay_seconds(source, destination)

    return max(0.01, distance / SPEED_OF_LIGHT_KM_S)


def calculate_distance_km(source_node: dict[str, Any], destination_node: dict[str, Any]) -> float | None:
    source_position = resolve_node_position(source_node)
    destination_position = resolve_node_position(destination_node)
    if source_position is None or destination_position is None:
        return None
    return math.dist(source_position.as_tuple(), destination_position.as_tuple())


def resolve_node_position(node: dict[str, Any]) -> Position3D | None:
    direct_position = _extract_cartesian_position(node)
    if direct_position is not None:
        return Position3D(*direct_position)

    settings = get_settings()
    planetary_bodies = settings.planetary_bodies

    if (
        node.get("surface_lat_deg") is not None
        and node.get("surface_lon_deg") is not None
        and isinstance(node.get("body"), str)
    ):
        body_name = str(node["body"]).lower()
        body = planetary_bodies.get(body_name)
        if body:
            return _surface_position(
                center=body["center"],
                radius_km=float(body["radius_km"]),
                lat_deg=float(node["surface_lat_deg"]),
                lon_deg=float(node["surface_lon_deg"]),
            )

    if node.get("orbit_altitude_km") is not None and isinstance(node.get("orbiting_body"), str):
        body_name = str(node["orbiting_body"]).lower()
        body = planetary_bodies.get(body_name)
        if body:
            orbital_radius = float(body["radius_km"]) + max(0.0, float(node.get("orbit_altitude_km", 0.0)))
            return _orbital_position(
                center=body["center"],
                orbital_radius_km=orbital_radius,
                phase_deg=float(node.get("orbital_phase_deg", 0.0)),
                inclination_deg=float(node.get("orbital_inclination_deg", 0.0)),
            )

    return None


def line_of_sight_clear(source_node: dict[str, Any], destination_node: dict[str, Any]) -> bool:
    source_position = resolve_node_position(source_node)
    destination_position = resolve_node_position(destination_node)

    if source_position is None or destination_position is None:
        return True

    source_bodies = _node_associated_bodies(source_node)
    destination_bodies = _node_associated_bodies(destination_node)

    settings = get_settings()
    for body_name, body in settings.planetary_bodies.items():
        source_on_body = body_name in source_bodies
        destination_on_body = body_name in destination_bodies

        # If only one endpoint belongs to the body, allow rays entering/leaving
        # that body without treating the destination/source body as an obstacle.
        if source_on_body ^ destination_on_body:
            continue

        if _segment_intersects_sphere_interior(
            p1=source_position.as_tuple(),
            p2=destination_position.as_tuple(),
            center=body["center"],
            radius=float(body["radius_km"]),
        ):
            return False

    return True


def _node_associated_bodies(node: dict[str, Any]) -> set[str]:
    values = {node.get("body"), node.get("orbiting_body")}
    return {
        str(item).lower()
        for item in values
        if isinstance(item, str) and item.strip()
    }


def _build_contacts_for_source(
    source_node_id: str,
    node_map: dict[str, dict[str, Any]],
    current_time_ts: float,
    deadline_ts: float,
) -> list[ContactOpportunity]:
    source_node = node_map.get(source_node_id)
    if source_node is None:
        return []

    neighbors = _collect_neighbors(source_node_id, node_map)
    windows = _active_windows(source_node, current_time_ts, deadline_ts)
    if not windows:
        return []

    opportunities: list[ContactOpportunity] = []
    for neighbor_id in neighbors:
        neighbor = node_map.get(neighbor_id)
        if neighbor is None:
            continue

        if not line_of_sight_clear(source_node, neighbor):
            continue

        distance_km = calculate_distance_km(source_node, neighbor)
        if distance_km is None:
            distance_km = _heuristic_distance_km(source_node, neighbor)
        delay_seconds = max(0.01, distance_km / SPEED_OF_LIGHT_KM_S)

        for start_ts, end_ts in windows:
            opportunities.append(
                ContactOpportunity(
                    source=source_node_id,
                    destination=neighbor_id,
                    start_ts=start_ts,
                    end_ts=end_ts,
                    delay_seconds=delay_seconds,
                    distance_km=distance_km,
                )
            )

    opportunities.sort(key=lambda item: item.start_ts)
    return opportunities


def _active_windows(
    source_node: dict[str, Any],
    current_time_ts: float,
    deadline_ts: float,
) -> list[tuple[float, float]]:
    raw_windows = source_node.get("contact_windows") or []

    if not raw_windows:
        return [(current_time_ts, deadline_ts)]

    windows: list[tuple[float, float]] = []
    for raw_window in raw_windows:
        start_dt = _to_datetime(raw_window.get("start"))
        end_dt = _to_datetime(raw_window.get("end"))
        if start_dt is None or end_dt is None:
            continue

        start_ts = start_dt.timestamp()
        end_ts = end_dt.timestamp()
        if end_ts < current_time_ts:
            continue

        bounded_start = max(start_ts, current_time_ts)
        bounded_end = min(end_ts, deadline_ts)
        if bounded_start < bounded_end:
            windows.append((bounded_start, bounded_end))

    return windows


def _collect_neighbors(
    current_node_id: str,
    node_map: dict[str, dict[str, Any]],
) -> list[str]:
    current_node = node_map.get(current_node_id)
    if current_node is None:
        return []

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
        return sorted(dict.fromkeys(linked_neighbors))

    return sorted(
        [node_id for node_id in node_map if node_id != current_node_id]
    )


def _is_better(candidate: tuple[float, float, int], current: tuple[float, float, int]) -> bool:
    if candidate[0] < current[0] - TIME_EPSILON:
        return True

    if abs(candidate[0] - current[0]) <= TIME_EPSILON:
        if candidate[1] < current[1] - DISTANCE_EPSILON:
            return True
        if abs(candidate[1] - current[1]) <= DISTANCE_EPSILON and candidate[2] < current[2]:
            return True

    return False


def _is_strictly_worse(candidate: tuple[float, float, int], current: tuple[float, float, int]) -> bool:
    return not _is_better(candidate, current) and candidate != current


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


def _to_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            return None

    return None


def _heuristic_distance_km(source_node: dict[str, Any], destination_node: dict[str, Any]) -> float:
    source_type = source_node.get("node_type")
    destination_type = destination_node.get("node_type")

    if source_type == "ground_station" and destination_type == "ground_station":
        return 15000.0
    if "satellite" in {source_type, destination_type}:
        return 2500.0
    if "relay" in {source_type, destination_type}:
        return 6000.0
    return 10000.0


def _heuristic_delay_seconds(source_node: dict[str, Any], destination_node: dict[str, Any]) -> float:
    return _heuristic_distance_km(source_node, destination_node) / SPEED_OF_LIGHT_KM_S


def _orbital_position(
    center: tuple[float, float, float],
    orbital_radius_km: float,
    phase_deg: float,
    inclination_deg: float,
) -> Position3D:
    phase = math.radians(phase_deg)
    inclination = math.radians(inclination_deg)

    x_local = orbital_radius_km * math.cos(phase)
    y_base = orbital_radius_km * math.sin(phase)
    y_local = y_base * math.cos(inclination)
    z_local = y_base * math.sin(inclination)

    return Position3D(
        x=float(center[0]) + x_local,
        y=float(center[1]) + y_local,
        z=float(center[2]) + z_local,
    )


def _surface_position(
    center: tuple[float, float, float],
    radius_km: float,
    lat_deg: float,
    lon_deg: float,
) -> Position3D:
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)

    cos_lat = math.cos(lat)
    x = center[0] + radius_km * cos_lat * math.cos(lon)
    y = center[1] + radius_km * cos_lat * math.sin(lon)
    z = center[2] + radius_km * math.sin(lat)

    return Position3D(x=x, y=y, z=z)


def _segment_intersects_sphere_interior(
    p1: tuple[float, float, float],
    p2: tuple[float, float, float],
    center: tuple[float, float, float],
    radius: float,
) -> bool:
    vx = p2[0] - p1[0]
    vy = p2[1] - p1[1]
    vz = p2[2] - p1[2]

    wx = center[0] - p1[0]
    wy = center[1] - p1[1]
    wz = center[2] - p1[2]

    segment_len_sq = vx * vx + vy * vy + vz * vz
    if segment_len_sq <= DISTANCE_EPSILON:
        return False

    t = (wx * vx + wy * vy + wz * vz) / segment_len_sq
    if t <= 1e-6 or t >= 1.0 - 1e-6:
        return False

    t_clamped = max(0.0, min(1.0, t))
    cx = p1[0] + t_clamped * vx
    cy = p1[1] + t_clamped * vy
    cz = p1[2] + t_clamped * vz

    distance_to_center = math.dist((cx, cy, cz), center)
    return distance_to_center < radius - DISTANCE_EPSILON
