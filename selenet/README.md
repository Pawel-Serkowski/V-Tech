# SELeNet Monorepo

SELeNet is a skeleton implementation of an Earth-Moon Gateway Communication Routing simulation based on Delay-Tolerant Networking principles.

## Included Services
- `frontend`: React + CoreUI command dashboard
- `backend`: FastAPI API gateway + CGR skeleton + websocket status stream
- `worker`: space-link simulator consuming RabbitMQ priority queue
- `mongo`: packet history and node configuration storage
- `rabbitmq`: priority queue broker

## Run
```bash
cd selenet
docker compose up --build
```

## Endpoints
- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs
- RabbitMQ Management: http://localhost:15672 (guest / guest)

## Key Backend Routes
- `POST /api/packets` - ingest packet, persist on Earth, enqueue by priority
- `GET /api/packets` - list recent packets
- `GET /api/packets/queue-load` - current queue load view (derived from stored packet statuses)
- `POST /api/packets/status` - internal status callback (worker -> backend)
- `POST /api/nodes` - upload node configs as JSON
- `POST /api/nodes/upload-file` - upload node configs as JSON or YAML file
- `GET /api/nodes` - list nodes
- `WS /ws/status` - real-time status stream

## Automatic Retry (WAITING_RETRY)
- Backend runs a retry loop that periodically scans packets in `WAITING_RETRY`.
- When a valid contact window appears, packet is automatically re-routed, switched to `QUEUED_ON_EARTH`, and published to RabbitMQ.
- Retry loop is configurable via environment:
	- `RETRY_SCAN_INTERVAL_SECONDS` (default `3` in compose)
	- `RETRY_BATCH_SIZE` (default `200` in compose)

## Multi-Window Node Configuration
- Sample config with multiple visibility windows:
	- `simulations/nodes.multi-window.json`

Upload example:
```bash
curl -X POST http://localhost:8000/api/nodes \
	-H 'Content-Type: application/json' \
	--data-binary @simulations/nodes.multi-window.json
```

## Retry Simulation (End-to-End)
Run automated simulation that forces `WAITING_RETRY`, opens windows, and verifies transition to `DELIVERED`:

```bash
chmod +x scripts/simulate_retry_flow.sh
./scripts/simulate_retry_flow.sh
```

## Notes
- Frontend, backend, and worker are built from a single multi-stage Dockerfile: `selenet/Dockerfile`.
- Priority queue uses RabbitMQ `x-max-priority`.
- Worker currently simulates transport delay and posts lifecycle updates back to backend.
- `time_offset_seconds` is stored for demonstrations, while routing logic uses Earth baseline time.