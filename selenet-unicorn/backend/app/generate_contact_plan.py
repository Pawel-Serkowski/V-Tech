#!/usr/bin/env python3
import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


@dataclass
class GeneratorConfig:
    horizon_hours: int
    window_duration_minutes: int
    window_period_minutes: int


def _parse_iso_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _to_iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _fallback_range_km(src: dict[str, Any], dst: dict[str, Any]) -> float:
    src_type = str(src.get("node_type", "")).strip().lower()
    dst_type = str(dst.get("node_type", "")).strip().lower()
    pair = {src_type, dst_type}

    if "ground_station" in pair and "satellite" in pair:
        return 384000.0
    if "ground_station" in pair and "relay" in pair:
        return 390000.0
    if "relay" in pair and "satellite" in pair:
        return 120000.0
    if src_type == "satellite" and dst_type == "satellite":
        return 180000.0
    return 250000.0


def _distance_range_km(src: dict[str, Any], dst: dict[str, Any]) -> float | None:
    coords = (
        src.get("position_x_km"),
        src.get("position_y_km"),
        src.get("position_z_km"),
        dst.get("position_x_km"),
        dst.get("position_y_km"),
        dst.get("position_z_km"),
    )
    if any(v is None for v in coords):
        return None

    sx, sy, sz, dx, dy, dz = (float(v) for v in coords)
    return ((dx - sx) ** 2 + (dy - sy) ** 2 + (dz - sz) ** 2) ** 0.5


def _compute_avg_range_km(src: dict[str, Any], dst: dict[str, Any]) -> float:
    measured = _distance_range_km(src, dst)
    if measured is not None and measured > 0:
        return round(measured, 3)
    return _fallback_range_km(src, dst)


def _generate_windows(
    source_id: str,
    dest_id: str,
    start_at: datetime,
    cfg: GeneratorConfig,
) -> list[dict[str, str]]:
    horizon_end = start_at + timedelta(hours=cfg.horizon_hours)
    period = timedelta(minutes=cfg.window_period_minutes)
    duration = timedelta(minutes=cfg.window_duration_minutes)

    # Deterministic phase offset keeps windows reproducible per directed link.
    digest = hashlib.sha256(f"{source_id}->{dest_id}".encode("utf-8")).digest()
    offset_seed = int.from_bytes(digest[:8], byteorder="big", signed=False)
    offset_minutes = offset_seed % max(1, cfg.window_period_minutes)
    current_start = start_at + timedelta(minutes=offset_minutes)

    windows: list[dict[str, str]] = []
    while current_start < horizon_end:
        current_end = min(current_start + duration, horizon_end)
        if current_end > current_start:
            windows.append(
                {
                    "start": _to_iso_z(current_start),
                    "end": _to_iso_z(current_end),
                }
            )
        current_start += period

    return windows


def _normalize_existing_windows(raw_windows: list[dict[str, Any]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for item in raw_windows:
        if not isinstance(item, dict):
            continue
        start_raw = item.get("start")
        end_raw = item.get("end")
        if not isinstance(start_raw, str) or not isinstance(end_raw, str):
            continue

        try:
            start_dt = _parse_iso_utc(start_raw)
            end_dt = _parse_iso_utc(end_raw)
        except Exception:
            continue

        if end_dt <= start_dt:
            continue

        normalized.append({"start": _to_iso_z(start_dt), "end": _to_iso_z(end_dt)})
    return normalized


def _merge_windows(windows: list[dict[str, str]]) -> list[dict[str, str]]:
    parsed = sorted(
        [(_parse_iso_utc(w["start"]), _parse_iso_utc(w["end"])) for w in windows],
        key=lambda x: x[0],
    )
    if not parsed:
        return []

    merged: list[tuple[datetime, datetime]] = [parsed[0]]
    for start, end in parsed[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    return [{"start": _to_iso_z(s), "end": _to_iso_z(e)} for s, e in merged]


def _is_satellite_like(node: dict[str, Any]) -> bool:
    node_type = str(node.get("node_type") or "").strip().lower()
    return node_type in {"satellite", "relay"}


def _windows_to_ranges(windows: list[dict[str, Any]]) -> list[tuple[datetime, datetime]]:
    ranges: list[tuple[datetime, datetime]] = []
    for item in windows:
        if not isinstance(item, dict):
            continue
        start_raw = item.get("start")
        end_raw = item.get("end")
        if not isinstance(start_raw, str) or not isinstance(end_raw, str):
            continue
        try:
            start_dt = _parse_iso_utc(start_raw)
            end_dt = _parse_iso_utc(end_raw)
        except Exception:
            continue
        if end_dt <= start_dt:
            continue
        ranges.append((start_dt, end_dt))

    ranges.sort(key=lambda item: item[0])
    if not ranges:
        return []

    merged: list[tuple[datetime, datetime]] = [ranges[0]]
    for start_dt, end_dt in ranges[1:]:
        last_start, last_end = merged[-1]
        if start_dt <= last_end:
            merged[-1] = (last_start, max(last_end, end_dt))
        else:
            merged.append((start_dt, end_dt))
    return merged


def _intersect_ranges(
    left: list[tuple[datetime, datetime]],
    right: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    output: list[tuple[datetime, datetime]] = []
    i = 0
    j = 0
    while i < len(left) and j < len(right):
        left_start, left_end = left[i]
        right_start, right_end = right[j]

        overlap_start = max(left_start, right_start)
        overlap_end = min(left_end, right_end)
        if overlap_end > overlap_start:
            output.append((overlap_start, overlap_end))

        if left_end <= right_end:
            i += 1
        else:
            j += 1

    return output


def _ranges_to_windows(
    ranges: list[tuple[datetime, datetime]],
    avg_range_km: float,
) -> list[dict[str, Any]]:
    return [
        {
            "start": _to_iso_z(start_dt),
            "end": _to_iso_z(end_dt),
            "avg_range_km": avg_range_km,
        }
        for start_dt, end_dt in ranges
    ]


def build_contact_plan(
    nodes_payload: list[dict[str, Any]],
    generation_start: datetime,
    cfg: GeneratorConfig,
) -> list[dict[str, Any]]:
    node_by_id = {
        str(item.get("node_id")): item
        for item in nodes_payload
        if isinstance(item, dict) and isinstance(item.get("node_id"), str)
    }

    contacts_by_key: dict[tuple[str, str], dict[str, Any]] = {}

    for node in nodes_payload:
        if not isinstance(node, dict):
            continue
        src = node.get("node_id")
        if not isinstance(src, str) or src not in node_by_id:
            continue

        links = node.get("links", [])

        for link in links:
            if not isinstance(link, dict):
                continue

            dst = link.get("dest_node")
            bandwidth_bps = int(link.get("bandwidth_bps", 1000000))
            raw_windows = link.get("windows", [])

            if not isinstance(dst, str) or dst not in node_by_id:
                continue

            dst_node = node_by_id[dst]
            avg_range_km = _compute_avg_range_km(node, dst_node)

            existing = _normalize_existing_windows(raw_windows if isinstance(raw_windows, list) else [])
            windows = existing or _generate_windows(src, dst, generation_start, cfg)
            windows = _merge_windows(windows)

            windows_with_range = [
                {
                    "start": item["start"],
                    "end": item["end"],
                    "avg_range_km": avg_range_km,
                }
                for item in windows
            ]

            contacts_by_key[(src, dst)] = {
                "source": src,
                "dest": dst,
                "bandwidth_bps": max(1, bandwidth_bps),
                "windows": windows_with_range,
                "_avg_range_km": avg_range_km,
            }

    processed_pairs: set[tuple[str, str]] = set()
    for (src, dst), contact in list(contacts_by_key.items()):
        if (src, dst) in processed_pairs:
            continue

        src_node = node_by_id.get(src)
        dst_node = node_by_id.get(dst)
        if src_node is None or dst_node is None:
            processed_pairs.add((src, dst))
            continue

        if not (_is_satellite_like(src_node) and _is_satellite_like(dst_node)):
            processed_pairs.add((src, dst))
            continue

        reverse = contacts_by_key.get((dst, src))
        if reverse is None:
            contact["windows"] = []
            processed_pairs.add((src, dst))
            continue

        forward_ranges = _windows_to_ranges(contact.get("windows", []))
        reverse_ranges = _windows_to_ranges(reverse.get("windows", []))
        mutual_ranges = _intersect_ranges(forward_ranges, reverse_ranges)

        contact["windows"] = _ranges_to_windows(mutual_ranges, float(contact.get("_avg_range_km", 0.0)))
        reverse["windows"] = _ranges_to_windows(mutual_ranges, float(reverse.get("_avg_range_km", 0.0)))

        processed_pairs.add((src, dst))
        processed_pairs.add((dst, src))

    contact_plan = []
    for contact in contacts_by_key.values():
        clean = dict(contact)
        clean.pop("_avg_range_km", None)
        contact_plan.append(clean)

    contact_plan.sort(key=lambda c: (c["source"], c["dest"]))
    return contact_plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate backend2 contact plan JSON from node topology JSON."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to topology JSON (supports {nodes:[...]} or [...]).",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output path for generated contact plan JSON.",
    )
    parser.add_argument(
        "--start",
        default=None,
        help="Generation start in ISO-8601 UTC (default: now UTC). Example: 2026-04-11T00:00:00Z",
    )
    parser.add_argument(
        "--horizon-hours",
        type=int,
        default=24,
        help="How far to generate synthetic windows when a link has no windows.",
    )
    parser.add_argument(
        "--window-duration-minutes",
        type=int,
        default=45,
        help="Duration of a synthetic contact window.",
    )
    parser.add_argument(
        "--window-period-minutes",
        type=int,
        default=180,
        help="Period between starts of synthetic windows.",
    )
    parser.add_argument(
        "--print",
        action="store_true",
        dest="print_contacts",
        help="Print generated contact plan JSON to stdout.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("nodes"), list):
        nodes_payload = payload["nodes"]
    elif isinstance(payload, list):
        nodes_payload = payload
    else:
        raise ValueError("Input JSON must be a list of nodes or an object with a 'nodes' field.")

    generation_start = _parse_iso_utc(args.start) if args.start else datetime.now(timezone.utc)

    cfg = GeneratorConfig(
        horizon_hours=max(1, args.horizon_hours),
        window_duration_minutes=max(1, args.window_duration_minutes),
        window_period_minutes=max(1, args.window_period_minutes),
    )

    contact_plan = build_contact_plan(nodes_payload, generation_start, cfg)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(contact_plan, indent=2), encoding="utf-8")

    if args.print_contacts:
        print(json.dumps(contact_plan, indent=2))

    print(f"Generated {len(contact_plan)} contacts -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
