from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

DispatchOriginScope = Literal["any", "earth", "moon", "satellite", "node"]


class Settings(BaseSettings):
    app_name: str = "selenet Control Backend v2"
    mongo_url: str = "mongodb://mongo:27017"
    mongo_db: str = "selenet"
    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672/"
    packet_queue_prefix: str = "packets"
    default_node_id: str = "EARTH_GATEWAY"
    status_exchange_name: str = "status.updates"
    rabbitmq_max_priority: int = 10
    cors_origins: str = "*"

    service_location: str = "Earth Mission Control"
    dispatch_origin_scope: DispatchOriginScope = "earth"
    dispatch_origin_node_id: str = ""
    dispatch_allowed_source_node_ids: str = ""

    earth_center_x_km: float = 0.0
    earth_center_y_km: float = 0.0
    earth_center_z_km: float = 0.0
    earth_radius_km: float = 6371.0

    moon_center_x_km: float = 384400.0
    moon_center_y_km: float = 0.0
    moon_center_z_km: float = 0.0
    moon_radius_km: float = 1737.4

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def allowed_source_nodes(self) -> list[str]:
        return [
            item.strip()
            for item in self.dispatch_allowed_source_node_ids.split(",")
            if item.strip()
        ]

    @property
    def planetary_bodies(self) -> dict[str, dict[str, tuple[float, float, float] | float]]:
        return {
            "earth": {
                "center": (
                    self.earth_center_x_km,
                    self.earth_center_y_km,
                    self.earth_center_z_km,
                ),
                "radius_km": self.earth_radius_km,
            },
            "moon": {
                "center": (
                    self.moon_center_x_km,
                    self.moon_center_y_km,
                    self.moon_center_z_km,
                ),
                "radius_km": self.moon_radius_km,
            },
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
