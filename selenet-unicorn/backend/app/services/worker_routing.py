from datetime import datetime, timezone
from typing import Any

from app.cgr import CGREngine


def compute_ttl_remaining_seconds(
    earth_timestamp_iso: str,
    ttl_seconds: int,
    now: datetime,
) -> int:
    try:
        earth_timestamp = datetime.fromisoformat(earth_timestamp_iso.replace("Z", "+00:00"))
    except ValueError:
        return max(0, int(ttl_seconds))

    if earth_timestamp.tzinfo is None or earth_timestamp.tzinfo.utcoffset(earth_timestamp) is None:
        earth_timestamp = earth_timestamp.replace(tzinfo=timezone.utc)
    else:
        earth_timestamp = earth_timestamp.astimezone(timezone.utc)

    elapsed = (now.astimezone(timezone.utc) - earth_timestamp).total_seconds()
    return max(0, int(ttl_seconds - elapsed))


def pick_next_hop(
    current_node: str,
    destination_node: str,
    nodes: list[dict[str, Any]],
    now: datetime,
    ttl_remaining_seconds: int,
    hop_limit_remaining: int,
) -> tuple[str | None, list[str]]:
    if ttl_remaining_seconds <= 0 or hop_limit_remaining <= 0:
        return None, []

    route = CGREngine.compute_route_hops(
        source_node=current_node,
        destination_node=destination_node,
        nodes=nodes,
        earth_timestamp=now,
        ttl_seconds=ttl_remaining_seconds,
        hop_limit=hop_limit_remaining,
    )

    if not route:
        return None, []

    return route[0], route
