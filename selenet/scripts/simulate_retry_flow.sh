#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"

echo "[1/5] Uploading CLOSED windows so packet starts in WAITING_RETRY..."
curl -sS -X POST "${API_BASE_URL}/api/nodes" \
  -H 'Content-Type: application/json' \
  -d '{
    "nodes": [
      {
        "node_id": "ESTRACK_PL",
        "node_type": "ground_station",
        "orbit": "Earth Surface",
        "time_offset_seconds": 0,
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2026-01-01T00:00:30Z"}
        ]
      },
      {
        "node_id": "LUNA_ORBITER_A",
        "node_type": "satellite",
        "orbit": "NRHO",
        "time_offset_seconds": 2,
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2026-01-01T00:00:30Z"}
        ]
      }
    ]
  }' > /tmp/selenet-retry-step1.json
cat /tmp/selenet-retry-step1.json

echo
echo "[2/5] Sending packet that should land in WAITING_RETRY..."
ACK_JSON="$(curl -sS -X POST "${API_BASE_URL}/api/packets" \
  -H 'Content-Type: application/json' \
  -d '{
    "source_node": "ESTRACK_PL",
    "destination_node": "LUNA_ORBITER_A",
    "priority": 2,
    "payload": {"telemetry": "retry-sim", "seq": 1}
  }')"
echo "${ACK_JSON}"

PACKET_ID="$(printf '%s' "${ACK_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["packet_id"])')"
echo "Packet ID: ${PACKET_ID}"

echo
echo "[3/5] Opening windows to trigger automatic retry engine..."
curl -sS -X POST "${API_BASE_URL}/api/nodes" \
  -H 'Content-Type: application/json' \
  -d '{
    "nodes": [
      {
        "node_id": "ESTRACK_PL",
        "node_type": "ground_station",
        "orbit": "Earth Surface",
        "time_offset_seconds": 0,
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"},
          {"start": "2027-01-02T00:00:00Z", "end": "2027-01-02T02:00:00Z"}
        ]
      },
      {
        "node_id": "LUNA_ORBITER_A",
        "node_type": "satellite",
        "orbit": "NRHO",
        "time_offset_seconds": 2,
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"},
          {"start": "2027-01-02T00:10:00Z", "end": "2027-01-02T03:00:00Z"}
        ]
      }
    ]
  }' > /tmp/selenet-retry-step3.json
cat /tmp/selenet-retry-step3.json

echo
echo "[4/5] Polling packet status (up to ~30 seconds)..."
export API_BASE_URL PACKET_ID
FINAL_STATUS="$(python3 - <<'PY'
import json
import os
import time
import urllib.request

base_url = os.environ["API_BASE_URL"]
packet_id = os.environ["PACKET_ID"]
status = "NOT_FOUND"

for _ in range(30):
    with urllib.request.urlopen(f"{base_url}/api/packets?limit=200") as response:
        rows = json.load(response)

    row = next((item for item in rows if item.get("packet_id") == packet_id), None)
    status = (row or {}).get("current_status", "NOT_FOUND")
    if status == "DELIVERED":
        print(status)
        break
    time.sleep(1)
else:
    print(status)
PY
)"

echo "Final observed status: ${FINAL_STATUS}"

echo
echo "[5/5] Packet history excerpt:"
curl -sS "${API_BASE_URL}/api/packets?limit=20" | python3 -c "import json,sys; pid='${PACKET_ID}'; rows=json.load(sys.stdin); row=next((r for r in rows if r.get('packet_id')==pid), None); print(json.dumps(row, indent=2))"

if [[ "${FINAL_STATUS}" != "DELIVERED" ]]; then
  echo "Simulation ended without DELIVERED status. Check backend/worker logs."
  exit 1
fi

echo "Simulation success: WAITING_RETRY was auto-retried and delivered."