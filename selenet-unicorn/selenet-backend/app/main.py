from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api import nodes, packets
from app.config import get_settings
from app.db import close_mongo_connection, connect_to_mongo
from app.rabbitmq import rabbit_publisher
from app.websocket_manager import ws_manager


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await connect_to_mongo()
    await rabbit_publisher.connect()
    yield
    await rabbit_publisher.close()
    await close_mongo_connection()


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.2.0",
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
