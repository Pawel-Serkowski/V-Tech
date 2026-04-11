from __future__ import annotations

import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any

REAL_EARTH_ROTATION_RAD_S = (2 * math.pi) / 86164.0905
DEFAULT_VISUAL_EARTH_ROTATION_RAD_S = 0.12


def _to_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    return None


def _to_float(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    if not math.isfinite(parsed):
        return default
    return parsed


def _default_acceleration() -> float:
    return DEFAULT_VISUAL_EARTH_ROTATION_RAD_S / REAL_EARTH_ROTATION_RAD_S


def _resolve_acceleration_from_env() -> float:
    explicit = os.getenv("SIMULATION_TIME_ACCELERATION", "").strip()
    if explicit:
        return max(1e-6, _to_float(explicit, _default_acceleration()))

    visual_rot = _to_float(
        os.getenv("VISUAL_EARTH_ROTATION_RAD_S", str(DEFAULT_VISUAL_EARTH_ROTATION_RAD_S)),
        DEFAULT_VISUAL_EARTH_ROTATION_RAD_S,
    )
    return max(1e-6, visual_rot / REAL_EARTH_ROTATION_RAD_S)


SIMULATION_TIME_ACCELERATION = _resolve_acceleration_from_env()
_SIMULATION_REAL_EPOCH_UTC = datetime.now(timezone.utc)
_SIMULATION_START_OVERRIDE_UTC = _to_utc_datetime(os.getenv("SIMULATION_START_ISO", "").strip())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_time_acceleration() -> float:
    return SIMULATION_TIME_ACCELERATION


def real_seconds_to_simulation_seconds(real_seconds: float, acceleration: float | None = None) -> float:
    acc = acceleration if acceleration is not None else SIMULATION_TIME_ACCELERATION
    return max(0.0, real_seconds) * max(1e-6, acc)


def simulation_seconds_to_real_seconds(simulation_seconds: float, acceleration: float | None = None) -> float:
    acc = acceleration if acceleration is not None else SIMULATION_TIME_ACCELERATION
    return max(0.0, simulation_seconds) / max(1e-6, acc)


def _contact_plan_bounds(contact_plan: list[dict[str, Any]] | None) -> tuple[datetime | None, datetime | None]:
    if not isinstance(contact_plan, list):
        return None, None

    min_start: datetime | None = None
    max_end: datetime | None = None

    for contact in contact_plan:
        if not isinstance(contact, dict):
            continue
        windows = contact.get("windows")
        if not isinstance(windows, list):
            continue

        for window in windows:
            if not isinstance(window, dict):
                continue

            start = _to_utc_datetime(window.get("start"))
            end = _to_utc_datetime(window.get("end"))
            if start is None or end is None or end <= start:
                continue

            if min_start is None or start < min_start:
                min_start = start
            if max_end is None or end > max_end:
                max_end = end

    return min_start, max_end


def resolve_simulation_now(
    contact_plan: list[dict[str, Any]] | None = None,
    real_now: datetime | None = None,
    acceleration: float | None = None,
) -> datetime:
    real_current = now_utc() if real_now is None else _to_utc_datetime(real_now) or now_utc()
    acc = acceleration if acceleration is not None else SIMULATION_TIME_ACCELERATION

    sim_start = _SIMULATION_START_OVERRIDE_UTC
    if sim_start is None:
        plan_start, _ = _contact_plan_bounds(contact_plan)
        sim_start = plan_start

    if sim_start is None:
        sim_start = _SIMULATION_REAL_EPOCH_UTC

    elapsed_real_seconds = max(0.0, (real_current - _SIMULATION_REAL_EPOCH_UTC).total_seconds())
    elapsed_sim_seconds = real_seconds_to_simulation_seconds(elapsed_real_seconds, acceleration=acc)
    return sim_start + timedelta(seconds=elapsed_sim_seconds)


def packet_simulation_now(
    packet_like: dict[str, Any],
    real_now: datetime | None = None,
    fallback_contact_plan: list[dict[str, Any]] | None = None,
) -> datetime:
    real_current = now_utc() if real_now is None else _to_utc_datetime(real_now) or now_utc()

    packet_acc = _to_float(packet_like.get("simulation_acceleration"), SIMULATION_TIME_ACCELERATION)
    packet_earth_ts = _to_utc_datetime(packet_like.get("earth_timestamp"))
    packet_real_anchor = _to_utc_datetime(packet_like.get("simulation_real_anchor"))

    if packet_earth_ts is not None and packet_real_anchor is not None:
        elapsed_real_seconds = max(0.0, (real_current - packet_real_anchor).total_seconds())
        elapsed_sim_seconds = real_seconds_to_simulation_seconds(
            elapsed_real_seconds,
            acceleration=packet_acc,
        )
        return packet_earth_ts + timedelta(seconds=elapsed_sim_seconds)

    if packet_earth_ts is not None:
        return packet_earth_ts

    return resolve_simulation_now(
        contact_plan=fallback_contact_plan,
        real_now=real_current,
        acceleration=packet_acc,
    )


def packet_sleep_seconds_for_simulation_delta(
    packet_like: dict[str, Any],
    simulation_seconds: float,
) -> float:
    packet_acc = _to_float(packet_like.get("simulation_acceleration"), SIMULATION_TIME_ACCELERATION)
    return simulation_seconds_to_real_seconds(simulation_seconds, acceleration=packet_acc)
