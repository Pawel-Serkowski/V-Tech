from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SELeNet Control Backend"
    mongo_url: str = "mongodb://mongo:27017"
    mongo_db: str = "selenet"
    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672/"
    packet_queue_name: str = "packets.priority"
    status_exchange_name: str = "status.updates"
    rabbitmq_max_priority: int = 10
    retry_scan_interval_seconds: float = 5.0
    retry_batch_size: int = 200
    cors_origins: str = "*"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()