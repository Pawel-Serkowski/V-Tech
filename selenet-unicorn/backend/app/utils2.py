import json
from typing import Any

def flatten_nodes_to_contact_plan(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    contact_plan = []
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
                "dest": link.get("dest_node"),
                "bandwidth_bps": link.get("bandwidth_bps", 1000000),
                "windows": link.get("windows", [])
            })
    return contact_plan

def estimate_packet_size(payload: dict[str, Any]) -> int:
    return len(json.dumps(payload, default=str).encode("utf-8"))