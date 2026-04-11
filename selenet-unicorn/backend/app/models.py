from datetime import datetime, timezone
from enum import IntEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class PacketPriority(IntEnum):
    CRITICAL = 1
    HIGH = 2
    BULK = 3

    @property
    # w rabbit piority jest od 10 do 0, a w aplikacji dla przejrzystości od 1 do 3
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
        if self.start.tzinfo is None or self.start.tzinfo.utcoffset(self.start) is None:
            raise ValueError("Contact window start must include timezone information.")
        if self.end.tzinfo is None or self.end.tzinfo.utcoffset(self.end) is None:
            raise ValueError("Contact window end must include timezone information.")

        self.start = self.start.astimezone(timezone.utc)
        self.end = self.end.astimezone(timezone.utc)

        if self.start >= self.end:
            raise ValueError("Contact window start must be before end.")
        return self

class LinkProfile(BaseModel):
    dest_node: str = Field(min_length=1)
    bandwidth_bps: int = Field(default=1000000, gt=0) # Domyślnie 1 Mbps
    windows: list[ContactWindow] = Field(default_factory=list)

class NodeConfig(BaseModel):
    node_id: str = Field(min_length=1)
    node_type: Literal["ground_station", "satellite", "relay"] = "satellite"
    orbit: str | None = None
    location_label: str | None = None
    position_x_km: float | None = None
    position_y_km: float | None = None
    position_z_km: float | None = None
    actual_position_x_km: float | None = None
    actual_position_y_km: float | None = None
    actual_position_z_km: float | None = None
    altitude_km: float | None = None
    body: str | None = None
    time_offset_seconds: int = 0
    # USUWAMY: contact_windows: list[ContactWindow]
    # ZMIENIAMY links na nową klasę:
    links: list[LinkProfile] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_links(self) -> "NodeConfig":
        cleaned_links: list[LinkProfile] = []
        seen: set[str] = set()

        for link in self.links:
            dest_id = link.dest_node.strip()
            if not dest_id or dest_id == self.node_id or dest_id in seen:
                continue
            seen.add(dest_id)
            link.dest_node = dest_id
            cleaned_links.append(link)

        self.links = cleaned_links

        coordinates = [self.position_x_km, self.position_y_km, self.position_z_km]
        provided_coordinates = sum(value is not None for value in coordinates)
        if provided_coordinates not in (0, 3):
            raise ValueError(
                "Node position must define all three Cartesian coordinates: "
                "position_x_km, position_y_km, position_z_km."
            )

        return self


class NodeUploadRequest(BaseModel):
    nodes: list[NodeConfig] = Field(min_length=1)


class PacketCreate(BaseModel):
    source_node: str = Field(min_length=1)
    destination_node: str = Field(min_length=1)
    payload: dict[str, Any]
    priority: PacketPriority = PacketPriority.BULK
    ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    hop_limit: int = Field(default=10, ge=2, le=50)

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
    node_id: str | None = None
    next_hop: str | None = None
    hop_index: int | None = None
    hop_total: int | None = None
    from_node: str | None = None
    to_node: str | None = None
    from_location: str | None = None
    to_location: str | None = None
    time_elapsed: float | None = None
    ttl_remaining: float | None = None


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
    route_locations: dict[str, str] = Field(default_factory=dict)
    earth_timestamp: datetime
    status_history: list[dict[str, Any]] = Field(default_factory=list)


class QueueLoadItem(BaseModel):
    node_id: str
    queued_packets: int