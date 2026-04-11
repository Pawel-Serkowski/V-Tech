import json
from datetime import datetime, timezone
from typing import Any


DEFAULT_RANGE_KM = 384000.0


def _to_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, str):
        # Handle Z suffix and ensure we don't duplicate offset if it already exists
        s = value.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(s)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    return None


def _to_iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _is_satellite_like(node_type: str | None) -> bool:
    return str(node_type or "").strip().lower() in {"satellite", "relay"}


def _extract_avg_range_km(windows: Any) -> float:
    if not isinstance(windows, list):
        return DEFAULT_RANGE_KM
    for item in windows:
        if not isinstance(item, dict):
            continue
        raw = item.get("avg_range_km")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return DEFAULT_RANGE_KM


def _normalize_windows(windows: Any) -> list[tuple[datetime, datetime]]:
    if not isinstance(windows, list):
        return []

    ranges: list[tuple[datetime, datetime]] = []
    for item in windows:
        if not isinstance(item, dict):
            continue
        start = _to_utc_datetime(item.get("start"))
        end = _to_utc_datetime(item.get("end"))
        if start is None or end is None or end <= start:
            continue
        ranges.append((start, end))

    ranges.sort(key=lambda window: window[0])
    if not ranges:
        return []

    merged: list[tuple[datetime, datetime]] = [ranges[0]]
    for start, end in ranges[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    return merged


def _intersect_ranges(
    left: list[tuple[datetime, datetime]],
    right: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    intersections: list[tuple[datetime, datetime]] = []
    i = 0
    j = 0

    while i < len(left) and j < len(right):
        left_start, left_end = left[i]
        right_start, right_end = right[j]

        overlap_start = max(left_start, right_start)
        overlap_end = min(left_end, right_end)
        if overlap_end > overlap_start:
            intersections.append((overlap_start, overlap_end))

        if left_end <= right_end:
            i += 1
        else:
            j += 1

    return intersections


def _ranges_to_windows(
    ranges: list[tuple[datetime, datetime]],
    avg_range_km: float,
) -> list[dict[str, Any]]:
    return [
        {
            "start": _to_iso_z(start),
            "end": _to_iso_z(end),
            "avg_range_km": avg_range_km,
        }
        for start, end in ranges
    ]


def _enforce_mutual_satellite_windows(
    contact_plan: list[dict[str, Any]],
    node_types: dict[str, str],
) -> None:
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for contact in contact_plan:
        src = contact.get("source")
        dst = contact.get("dest")
        if isinstance(src, str) and isinstance(dst, str):
            by_key[(src, dst)] = contact

    processed_pairs: set[tuple[str, str]] = set()
    for (src, dst), forward in list(by_key.items()):
        if (src, dst) in processed_pairs:
            continue

        if not (_is_satellite_like(node_types.get(src)) and _is_satellite_like(node_types.get(dst))):
            processed_pairs.add((src, dst))
            continue

        reverse = by_key.get((dst, src))
        if reverse is None:
            forward["windows"] = []
            processed_pairs.add((src, dst))
            continue

        forward_ranges = _normalize_windows(forward.get("windows"))
        reverse_ranges = _normalize_windows(reverse.get("windows"))
        mutual_ranges = _intersect_ranges(forward_ranges, reverse_ranges)

        forward_avg_range = _extract_avg_range_km(forward.get("windows"))
        reverse_avg_range = _extract_avg_range_km(reverse.get("windows"))
        forward["windows"] = _ranges_to_windows(mutual_ranges, forward_avg_range)
        reverse["windows"] = _ranges_to_windows(mutual_ranges, reverse_avg_range)

        processed_pairs.add((src, dst))
        processed_pairs.add((dst, src))

def flatten_nodes_to_contact_plan(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    contact_plan: list[dict[str, Any]] = []
    node_types = {
        str(node.get("node_id")): str(node.get("node_type") or "")
        for node in nodes
        if isinstance(node, dict) and isinstance(node.get("node_id"), str)
    }

    for node in nodes:
        source_id = node.get("node_id")
        shared_windows = node.get("contact_windows") if isinstance(node.get("contact_windows"), list) else []
        for link in node.get("links", []):
            if isinstance(link, str):
                contact_plan.append({
                    "source": source_id,
                    "dest": link,
                    "bandwidth_bps": 1000000,
                    "windows": shared_windows,
                })
                continue
            if not isinstance(link, dict):
                continue

            contact_plan.append({
                "source": source_id,
                "dest": link.get("dest_node") or link.get("destination"),
                "bandwidth_bps": link.get("bandwidth_bps", 1000000),
                "windows": link.get("windows", [])
            })

    _enforce_mutual_satellite_windows(contact_plan, node_types)
    return contact_plan

def estimate_packet_size(payload: dict[str, Any]) -> int:
    return len(json.dumps(payload, default=str).encode("utf-8"))