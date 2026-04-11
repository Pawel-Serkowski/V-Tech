from typing import Any

from .db import get_database
from .models import NodeConfig


DEFAULT_TOPOLOGY: list[dict[str, Any]] = [
    {
        "node_id": "EARTH_GATEWAY",
        "node_type": "ground_station",
        "orbit": "Earth Surface",
        "location_label": "Earth Mission Control",
        "time_offset_seconds": 0,
        "links": [
            {
                "dest_node": "SAT_1",
                "bandwidth_bps": 5000000,  #strong earth sattelire
                "windows": [{"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}]
            }
        ]
    },
    {
        "node_id": "SAT_1",
        "node_type": "satellite",
        "orbit": "Cislunar Transfer Relay",
        "location_label": "Cislunar Relay A",
        "time_offset_seconds": 1,
        "links": [
            {
                "dest_node": "EARTH_GATEWAY",
                "bandwidth_bps": 1000000, #satellite -> earth
                "windows": [{"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}]
            },
            {
                "dest_node": "SAT_2",
                "bandwidth_bps": 2000000,
                "windows": [{"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}]
            }
        ]
    },
    {
        "node_id": "SAT_2",
        "node_type": "satellite",
        "orbit": "Lunar Relay Orbit",
        "location_label": "Lunar Far Side Relay",
        "time_offset_seconds": 2,
        "links": [
            {
                "dest_node": "SAT_1",
                "bandwidth_bps": 2000000,
                "windows": [{"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}]
            },
            {
                "dest_node": "LUNA_ORBITER_A",
                "bandwidth_bps": 500000, # weak moon sattelite
                "windows": [{"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}]
            }
        ]
    },
    {
        "node_id": "LUNA_ORBITER_A",
        "node_type": "relay",
        "orbit": "NRHO Lunar Gateway",
        "location_label": "Lunar Gateway Hub",
        "time_offset_seconds": 3,
        "links": [
            {
                "dest_node": "SAT_2",
                "bandwidth_bps": 500000,
                "windows": [{"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}]
            }
        ]
    },
]


async def seed_default_nodes_if_empty() -> int:
    db = get_database()
    existing_count = await db.nodes.count_documents({})
    if existing_count > 0:
        return 0

    validated_nodes = [NodeConfig.model_validate(item) for item in DEFAULT_TOPOLOGY]
    inserted = 0
    for node in validated_nodes:
        payload = node.model_dump(mode="json")
        result = await db.nodes.update_one(
            {"node_id": node.node_id},
            {"$set": payload},
            upsert=True,
        )
        if result.upserted_id:
            inserted += 1

    return inserted
