# Earth-Moon Gateway Communication Routing (selnet)

## Mission
Build a delay-tolerant networking simulation that routes packets between Earth ground nodes and Moon satellites.

## Core Architectural Decisions
- Split architecture: Frontend <-> Backend uses REST + WebSocket.
- Immediate ACK: Backend confirms packet persistence on Earth as soon as it stores packet metadata.
- Brokered routing: Backend publishes packet envelopes to RabbitMQ priority queues.
- Multi-hop route planning: Backend computes `route_hops` from source to destination using contact windows and node links.
- DTN simulation: Worker consumes packets and simulates intermittent links and transmission delay for each hop.
- Earth time baseline: Routing logic uses Earth time only (`earth_timestamp`) while keeping `time_offset_seconds` in node configs for demo and analysis.

## Primary Components
- Frontend dashboard (`frontend`): command center UI for packets, queue load, and node configuration uploads.
- Backend API (`backend/app`): packet ingest, CGR route selection, persistence, websocket push.
- Space link worker (`backend/worker`): consumes priority queue and posts status updates back to backend.
- MongoDB: stores node configuration and packet status history.
- RabbitMQ: stores per-packet priority in a durable queue with `x-max-priority`.

## QoS Priority Convention
- `1` = Critical (mapped to highest RabbitMQ priority)
- `2` = High
- `3` = Bulk

## Current Scope
This repository contains a runnable project skeleton for local development in Docker Compose, not a full mission-grade implementation.