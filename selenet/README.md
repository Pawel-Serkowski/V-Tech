# SELeNet Monorepo

SELeNet is a skeleton implementation of an Earth-Moon Gateway Communication Routing simulation based on Delay-Tolerant Networking principles.

## Included Services
- `frontend`: React + CoreUI command dashboard
- `backend`: FastAPI API gateway + CGR skeleton + websocket status stream
- `worker_*`: decentralized space-link simulators (one queue consumer per `NODE_ID`)
- `mongo`: packet history and node configuration storage
- `rabbitmq`: priority queue broker

## Run
```bash
cd selenet
docker compose up --build
```

## Endpoints
- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs (compat) or http://localhost:8001/docs
- RabbitMQ Management: http://localhost:15672 (guest / guest)

## Key Backend Routes
- `POST /api/packets` - ingest packet, persist on Earth, compute route plan (`route_hops`), enqueue to source node queue
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

Node schema supports optional directed links:
- `links`: list of next-hop node IDs available from this node.

If `links` are omitted for a node, the router falls back to legacy behavior and considers all known nodes as candidates.

## Multi-Hop Routing and Telemetry
- Backend computes full route plans as `route_hops` (for example: `RELAY_A -> RELAY_B -> DEST`).
- Workers emit hop-by-hop `IN_TRANSIT` updates with:
	- `hop_index`, `hop_total`
	- `from_node`, `to_node`
- Status updates can include optional hop location labels:
	- `from_location`, `to_location`
- Packet `status_history` now records traversal across intermediate satellites/relays.

## Decentralized Workers (Store-and-Forward)
- Every worker instance consumes exactly one queue: `packets.<NODE_ID>`.
- Initial enqueue target is the source node queue (`source_node`).
- Worker flow per message:
	1) consume from its own queue,
	2) simulate exactly one hop delay,
	3) publish remaining route to queue of next node.
- Queue prefix is configurable via `PACKET_QUEUE_PREFIX` (default: `packets`).

Current compose profile starts these sample instances:
- `NODE_ID=EARTH_GATEWAY`
- `NODE_ID=SAT_1`
- `NODE_ID=SAT_2`
- `NODE_ID=LUNAR_GATEWAY`

For custom topologies, add more worker services with matching `NODE_ID` values used in node config.

## Determining Satellite Location Immediately
- Preferred: define `location_label` (or `orbit`) in node configuration for each node.
- Runtime override: set `NODE_LOCATION` on a worker container for immediate instance labeling.
- Backend stores per-route location map in `route_locations` and workers emit location-aware telemetry.

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
- Worker simulates one transport hop per message and forwards packet envelopes between node queues.
- `time_offset_seconds` is stored for demonstrations, while routing logic uses Earth baseline time.
