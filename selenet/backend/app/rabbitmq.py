import json
from typing import Any

import aio_pika
from aio_pika.abc import AbstractRobustChannel, AbstractRobustConnection

from app.config import get_settings


class RabbitPublisher:
    def __init__(self) -> None:
        self.connection: AbstractRobustConnection | None = None
        self.channel: AbstractRobustChannel | None = None

    async def connect(self) -> None:
        settings = get_settings()

        if self.connection and not self.connection.is_closed:
            return

        self.connection = await aio_pika.connect_robust(settings.rabbitmq_url)
        self.channel = await self.connection.channel()
        await self.channel.set_qos(prefetch_count=20)

        await self.channel.declare_queue(
            settings.packet_queue_name,
            durable=True,
            arguments={"x-max-priority": settings.rabbitmq_max_priority},
        )

        await self.channel.declare_exchange(
            settings.status_exchange_name,
            aio_pika.ExchangeType.FANOUT,
            durable=True,
        )

    async def publish_packet(self, packet_envelope: dict[str, Any], rabbit_priority: int) -> None:
        if self.channel is None or self.channel.is_closed:
            await self.connect()

        if self.channel is None:
            raise RuntimeError("RabbitMQ channel is not initialized.")

        message = aio_pika.Message(
            body=json.dumps(packet_envelope, default=str).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            priority=rabbit_priority,
        )

        await self.channel.default_exchange.publish(
            message,
            routing_key=get_settings().packet_queue_name,
        )

    async def close(self) -> None:
        if self.connection and not self.connection.is_closed:
            await self.connection.close()

        self.connection = None
        self.channel = None


rabbit_publisher = RabbitPublisher()