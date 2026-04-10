from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect_to_mongo() -> None:
    global _client, _db

    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongo_url)
    _db = _client[settings.mongo_db]

    await _db.nodes.create_index("node_id", unique=True)
    await _db.packets.create_index("packet_id", unique=True)


def get_database() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("MongoDB is not initialized.")
    return _db


async def close_mongo_connection() -> None:
    global _client, _db

    if _client is not None:
        _client.close()

    _client = None
    _db = None