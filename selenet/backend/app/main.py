from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api import nodes, packets
from app.config import get_settings
from app.db import close_mongo_connection, connect_to_mongo, get_database
from app.rabbitmq import rabbit_publisher
from app.retry_engine import packet_retry_engine
from app.websocket_manager import ws_manager


async def _reconcile_cancelled_packets_on_startup() -> int:
    db = get_database()

    result = await db.packets.update_many(
        {
            "cancel_requested": True,
            "current_status": {
                "$in": [
                    "QUEUED_ON_EARTH",
                    "WAITING_RETRY",
                    "IN_TRANSIT",
                ]
            },
        },
        {
            "$set": {
                "current_status": "CANCELLED",
            },
        },
    )
    return result.modified_count


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await connect_to_mongo()
    updated_count = await _reconcile_cancelled_packets_on_startup()
    if updated_count:
        print(f"[startup] reconciled {updated_count} cancelled packet(s) stuck in active statuses")
    await rabbit_publisher.connect()
    packet_retry_engine.start()
    yield
    await packet_retry_engine.stop()
    await rabbit_publisher.close()
    await close_mongo_connection()


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(packets.router, prefix="/api/packets", tags=["packets"])
app.include_router(nodes.router, prefix="/api/nodes", tags=["nodes"])


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/status")
async def ws_status(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)