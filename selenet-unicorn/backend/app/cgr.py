from datetime import datetime, timezone
import heapq
import math
from typing import Any


SPEED_OF_LIGHT_KM_S = 299792.458
SATELLITE_CONE_HALF_ANGLE_DEG = 60.0  # 120 deg full cone aperture
SATELLITE_CONE_MIN_DOT = math.cos(math.radians(SATELLITE_CONE_HALF_ANGLE_DEG))

EARTH_CENTER = (0.0, 0.0, 0.0)
EARTH_RADIUS_KM = 6371.0
MOON_CENTER = (384400.0, 0.0, 0.0)
MOON_RADIUS_KM = 1737.4


def _to_timestamp(value: Any) -> float | None:
    if isinstance(value, datetime):
        return value.timestamp()

    if isinstance(value, str):
        try:
            normalized = value.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized).timestamp()
        except ValueError:
            return None

    return None

def calculate_link_delays(packet_size_bytes: int, bandwidth_bps: int, range_km: float) -> tuple[float, float]:
    if bandwidth_bps <= 0:
        return float('inf'), float('inf')
        
    packet_size_bits = packet_size_bytes * 8
    
    propagation_delay = range_km / SPEED_OF_LIGHT_KM_S
    transmission_delay = packet_size_bits / bandwidth_bps
    
    return propagation_delay, transmission_delay


def _vec_sub(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _vec_dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _vec_length(a: tuple[float, float, float]) -> float:
    return math.sqrt(_vec_dot(a, a))


def _vec_norm(a: tuple[float, float, float]) -> tuple[float, float, float] | None:
    length = _vec_length(a)
    if length <= 1e-9:
        return None
    return (a[0] / length, a[1] / length, a[2] / length)


def _body_center_and_radius(node: dict[str, Any]) -> tuple[tuple[float, float, float], float]:
    body_text = str(node.get("body") or node.get("orbiting_body") or "").strip().lower()
    orbit_text = str(node.get("orbit") or "").strip().lower()
    location_text = str(node.get("location_label") or "").strip().lower()

    is_moon = (
        body_text == "moon"
        or "moon" in orbit_text
        or "luna" in orbit_text
        or "lunar" in orbit_text
        or "moon" in location_text
        or "luna" in location_text
        or "lunar" in location_text
    )

    if is_moon:
        return MOON_CENTER, MOON_RADIUS_KM
    return EARTH_CENTER, EARTH_RADIUS_KM


def _derive_orbital_position(node: dict[str, Any]) -> tuple[float, float, float] | None:
    center, radius_km = _body_center_and_radius(node)

    raw_alt = node.get("altitude_km")
    if raw_alt is None:
        raw_alt = node.get("orbit_altitude_km")
    try:
        altitude_km = float(raw_alt)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(altitude_km):
        return None

    try:
        phase_deg = float(node.get("orbital_phase_deg", 0.0))
    except (TypeError, ValueError):
        phase_deg = 0.0
    try:
        incl_deg = float(node.get("orbital_inclination_deg", 0.0))
    except (TypeError, ValueError):
        incl_deg = 0.0

    r = radius_km + max(0.0, altitude_km)
    phase = math.radians(phase_deg)
    incl = math.radians(incl_deg)

    x_local = r * math.cos(phase)
    y_base = r * math.sin(phase)
    y_local = y_base * math.cos(incl)
    z_local = y_base * math.sin(incl)

    return (center[0] + x_local, center[1] + y_local, center[2] + z_local)


def _extract_position(node: dict[str, Any]) -> tuple[float, float, float] | None:
    candidates = [
        (
            node.get("actual_position_x_km"),
            node.get("actual_position_y_km"),
            node.get("actual_position_z_km"),
        ),
        (
            node.get("position_x_km"),
            node.get("position_y_km"),
            node.get("position_z_km"),
        ),
    ]
    for raw_x, raw_y, raw_z in candidates:
        try:
            x = float(raw_x)
            y = float(raw_y)
            z = float(raw_z)
        except (TypeError, ValueError):
            continue
        if math.isfinite(x) and math.isfinite(y) and math.isfinite(z):
            return (x, y, z)
    return _derive_orbital_position(node)


def _infer_body_name(node: dict[str, Any], position: tuple[float, float, float]) -> str:
    body_text = str(node.get("body") or node.get("orbiting_body") or "").strip().lower()
    orbit_text = str(node.get("orbit") or "").strip().lower()
    location_text = str(node.get("location_label") or "").strip().lower()

    if body_text in {"earth", "moon"}:
        return body_text
    if "moon" in orbit_text or "luna" in orbit_text or "lunar" in orbit_text:
        return "moon"
    if "moon" in location_text or "luna" in location_text or "lunar" in location_text:
        return "moon"
    if "earth" in orbit_text:
        return "earth"

    earth_dist = _vec_length(_vec_sub(position, EARTH_CENTER))
    moon_dist = _vec_length(_vec_sub(position, MOON_CENTER))
    return "moon" if moon_dist < earth_dist else "earth"


def _distance_point_to_segment(
    point: tuple[float, float, float],
    seg_a: tuple[float, float, float],
    seg_b: tuple[float, float, float],
) -> float:
    ab = _vec_sub(seg_b, seg_a)
    ap = _vec_sub(point, seg_a)
    ab_len_sq = _vec_dot(ab, ab)
    if ab_len_sq <= 1e-12:
        return _vec_length(ap)

    t = max(0.0, min(1.0, _vec_dot(ap, ab) / ab_len_sq))
    closest = (seg_a[0] + ab[0] * t, seg_a[1] + ab[1] * t, seg_a[2] + ab[2] * t)
    return _vec_length(_vec_sub(point, closest))


def _has_clear_line_of_sight(
    source_pos: tuple[float, float, float],
    dest_pos: tuple[float, float, float],
) -> bool:
    checks = [
        (EARTH_CENTER, EARTH_RADIUS_KM),
        (MOON_CENTER, MOON_RADIUS_KM),
    ]
    for center, radius in checks:
        if _distance_point_to_segment(center, source_pos, dest_pos) < radius:
            return False
    return True


def _is_satellite_like(node: dict[str, Any]) -> bool:
    node_type = str(node.get("node_type") or "").strip().lower()
    return node_type in {"satellite", "relay"}


def _satellite_link_cone_allows(
    source_node: dict[str, Any],
    source_pos: tuple[float, float, float],
    dest_node: dict[str, Any],
    dest_pos: tuple[float, float, float],
) -> bool:
    if not (_is_satellite_like(source_node) and _is_satellite_like(dest_node)):
        return True

    source_body = _infer_body_name(source_node, source_pos)
    dest_body = _infer_body_name(dest_node, dest_pos)
    source_center = MOON_CENTER if source_body == "moon" else EARTH_CENTER
    dest_center = MOON_CENTER if dest_body == "moon" else EARTH_CENTER

    source_axis = _vec_norm(_vec_sub(source_pos, source_center))
    dest_axis = _vec_norm(_vec_sub(dest_pos, dest_center))
    if source_axis is None or dest_axis is None:
        return False

    source_to_dest = _vec_norm(_vec_sub(dest_pos, source_pos))
    dest_to_source = _vec_norm(_vec_sub(source_pos, dest_pos))
    if source_to_dest is None or dest_to_source is None:
        return False

    source_ok = _vec_dot(source_axis, source_to_dest) >= SATELLITE_CONE_MIN_DOT
    dest_ok = _vec_dot(dest_axis, dest_to_source) >= SATELLITE_CONE_MIN_DOT
    return source_ok and dest_ok


def _is_link_geometry_allowed(
    source_node: dict[str, Any] | None,
    dest_node: dict[str, Any] | None,
) -> bool:
    # If topology node metadata is missing, fall back to contact-window-only routing.
    if not source_node or not dest_node:
        return True

    source_pos = _extract_position(source_node)
    dest_pos = _extract_position(dest_node)
    if source_pos is None or dest_pos is None:
        return True

    if not _has_clear_line_of_sight(source_pos, dest_pos):
        return False

    return _satellite_link_cone_allows(source_node, source_pos, dest_node, dest_pos)

class CGREngine:
    @staticmethod
    def compute_route_hops(
        source_node: str,
        destination_node: str,
        contact_plan: list[dict],
        earth_timestamp: datetime,
        packet_size_bytes: int, 
        ttl_seconds: int = 3600,
        hop_limit: int = 10,
        nodes: list[dict[str, Any]] | None = None,
    ) -> list[str] | None:
        current_time_ts = earth_timestamp.timestamp()
        deadline = current_time_ts + ttl_seconds

        plan_by_source = {} #mapa sasiedztwa z perspektywy nadawcy
        for contact in contact_plan:
            src = contact["source"]
            if src not in plan_by_source:
                plan_by_source[src] = []
            plan_by_source[src].append(contact)

        earliest_arrival = {source_node: current_time_ts}
        priority_queue = [(current_time_ts, source_node, [])]
        nodes_by_id = {
            item.get("node_id"): item
            for item in (nodes or [])
            if isinstance(item.get("node_id"), str)
        }

        while priority_queue:
            arrival_time, current_node, path = heapq.heappop(priority_queue)

            if len(path) >= hop_limit or arrival_time > deadline:
                continue

            if arrival_time > earliest_arrival.get(current_node, float('inf')):
                continue
            
            if current_node == destination_node:
                return path 
            
            for link in plan_by_source.get(current_node, []):
                dest_node = link["dest"]

                if nodes_by_id and not _is_link_geometry_allowed(nodes_by_id.get(current_node), nodes_by_id.get(dest_node)):
                    continue
                
                if dest_node in path:
                    continue # Unikamy pętli
                
                bandwidth = link.get("bandwidth_bps", 1)
                
                for window in link.get("windows", []):
                    window_start = _to_timestamp(window.get("start"))
                    window_end = _to_timestamp(window.get("end"))
                    if window_start is None or window_end is None:
                        continue
                    range_km = window.get("avg_range_km", 384000)

                    start_tx_time = max(arrival_time, window_start)

                    prop_delay, trans_delay = calculate_link_delays(packet_size_bytes, bandwidth, range_km)
                    end_rx_time = start_tx_time + trans_delay + prop_delay
                    
                    if start_tx_time + trans_delay + prop_delay <= window_end:
                        
                        if end_rx_time < earliest_arrival.get(dest_node, float('inf')):
                            earliest_arrival[dest_node] = end_rx_time
                            heapq.heappush(priority_queue, (end_rx_time, dest_node, path + [dest_node]))

        return None 
