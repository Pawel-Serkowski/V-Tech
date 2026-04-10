from datetime import datetime
from enum import IntEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class PacketPriority(IntEnum):
    CRITICAL = 1
    HIGH = 2
    BULK = 3

    @property
    def rabbit_priority(self) -> int:
        mapping = {
            PacketPriority.CRITICAL: 10,
            PacketPriority.HIGH: 6,
            PacketPriority.BULK: 2,
        }
        return mapping[self]


class ContactWindow(BaseModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def validate_window_order(self) -> "ContactWindow":
        if self.start >= self.end:
            raise ValueError("Contact window start must be before end.")
        return self


class NodeConfig(BaseModel):
    node_id: str = Field(min_length=1)
    node_type: Literal["ground_station", "satellite", "relay"] = "satellite"
    orbit: str | None = None
    time_offset_seconds: int = 0
    contact_windows: list[ContactWindow] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_links(self) -> "NodeConfig":
        cleaned_links: list[str] = []
        seen: set[str] = set()

        for item in self.links:
            node_id = item.strip()
            if not node_id or node_id == self.node_id or node_id in seen:
                continue
            seen.add(node_id)
            cleaned_links.append(node_id)

        self.links = cleaned_links
        return self


class NodeUploadRequest(BaseModel):
    nodes: list[NodeConfig] = Field(min_length=1)


class PacketCreate(BaseModel):
    source_node: str = Field(min_length=1)
    destination_node: str = Field(min_length=1)
    payload: dict[str, Any]
    priority: PacketPriority = PacketPriority.BULK

    @field_validator("source_node", "destination_node")
    @classmethod
    def strip_and_validate_nodes(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Node identifiers cannot be empty.")
        return cleaned


class PacketAck(BaseModel):
    packet_id: str
    status: str
    earth_timestamp: datetime
    next_hop: str | None = None
    route_hops: list[str] = Field(default_factory=list)


class PacketStatusUpdate(BaseModel):
    packet_id: str = Field(min_length=1)
    status: str = Field(min_length=1)
    at: datetime
    detail: str | None = None
    next_hop: str | None = None
    hop_index: int | None = None
    hop_total: int | None = None
    from_node: str | None = None
    to_node: str | None = None


class PacketSummary(BaseModel):
    packet_id: str
    source_node: str
    destination_node: str
    priority: int
    current_status: str
    cancel_requested: bool = False
    cancel_requested_at: datetime | None = None
    next_hop: str | None = None
    route_hops: list[str] = Field(default_factory=list)
    earth_timestamp: datetime
    status_history: list[dict[str, Any]] = Field(default_factory=list)


class QueueLoadItem(BaseModel):
    node_id: str
    queued_packets: int