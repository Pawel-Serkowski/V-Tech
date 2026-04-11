import asyncio
import json
from typing import Any

import aio_pika
from aio_pika.abc import AbstractRobustChannel, AbstractRobustConnection

from app.config import get_settings


def _sanitize_node_id(node_id: str | None) -> str:
    raw_value = (node_id or "").strip()
    if not raw_value:
        return get_settings().default_node_id

    sanitized = "".join(
        char if char.isalnum() or char in {"_", "-", "."} else "_"
        for char in raw_value
    )
    return sanitized or get_settings().default_node_id


def packet_queue_name_for_node(node_id: str | None) -> str:
    settings = get_settings()
    prefix = settings.packet_queue_prefix.strip() or "packets"
    return f"{prefix}.{_sanitize_node_id(node_id)}"


class RabbitPublisher:
    def __init__(self) -> None:
        self.connection: AbstractRobustConnection | None = None
        self.channel: AbstractRobustChannel | None = None
        self._declared_queues: set[str] = set()

    async def connect(self, retries: int = 20, retry_delay_seconds: float = 1.5) -> None:
        settings = get_settings()

        if self.connection and not self.connection.is_closed:
            return

        last_error: Exception | None = None
        for attempt in range(1, retries + 1):
            try:
                self.connection = await aio_pika.connect_robust(settings.rabbitmq_url)
                self.channel = await self.connection.channel()
                await self.channel.set_qos(prefetch_count=20)
                self._declared_queues = set()

                await self.channel.declare_exchange(
                    settings.status_exchange_name,
                    aio_pika.ExchangeType.FANOUT,
                    durable=True,
                )
                return
            except Exception as exc:
                last_error = exc
                if attempt == retries:
                    break
                await asyncio.sleep(retry_delay_seconds)

        if last_error is not None:
            raise last_error

    async def _ensure_packet_queue(self, queue_name: str) -> None:
        if self.channel is None:
            raise RuntimeError("RabbitMQ channel is not initialized.")

        if queue_name in self._declared_queues:
            return

        await self.channel.declare_queue(
            queue_name,
            durable=True,
            arguments={"x-max-priority": get_settings().rabbitmq_max_priority},
        )
        self._declared_queues.add(queue_name)

    async def publish_packet(
        self,
        packet_envelope: dict[str, Any],
        rabbit_priority: int,
        queue_name: str,
    ) -> None:
        if self.channel is None or self.channel.is_closed:
            await self.connect()

        if self.channel is None:
            raise RuntimeError("RabbitMQ channel is not initialized.")

        await self._ensure_packet_queue(queue_name)

        message = aio_pika.Message(
            body=json.dumps(packet_envelope, default=str).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            priority=rabbit_priority,
        )

        await self.channel.default_exchange.publish(message, routing_key=queue_name)

    async def close(self) -> None:
        if self.connection and not self.connection.is_closed:
            await self.connection.close()

        self.connection = None
        self.channel = None
        self._declared_queues = set()


rabbit_publisher = RabbitPublisher()
