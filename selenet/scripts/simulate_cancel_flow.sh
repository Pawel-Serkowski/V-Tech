#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8001}"
CANCEL_DELAY_SECONDS="${CANCEL_DELAY_SECONDS:-1}"
POLL_SECONDS="${POLL_SECONDS:-10}"

if ! [[ "${CANCEL_DELAY_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "CANCEL_DELAY_SECONDS must be a non-negative integer"
  exit 2
fi

if ! [[ "${POLL_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "POLL_SECONDS must be a non-negative integer"
  exit 2
fi

echo "[1/6] Uploading deterministic multi-hop node config..."
curl -sS -X POST "${API_BASE_URL}/api/nodes" \
  -H 'Content-Type: application/json' \
  -d '{
    "nodes": [
      {
        "node_id": "GS_CANCEL_TEST",
        "node_type": "ground_station",
        "orbit": "Earth Surface",
        "time_offset_seconds": 0,
        "links": ["SAT_CANCEL_R1"],
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}
        ]
      },
      {
        "node_id": "SAT_CANCEL_R1",
        "node_type": "satellite",
        "orbit": "Relay 1",
        "time_offset_seconds": 0,
        "links": ["SAT_CANCEL_R2"],
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}
        ]
      },
      {
        "node_id": "SAT_CANCEL_R2",
        "node_type": "satellite",
        "orbit": "Relay 2",
        "time_offset_seconds": 0,
        "links": ["SAT_CANCEL_DST"],
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}
        ]
      },
      {
        "node_id": "SAT_CANCEL_DST",
        "node_type": "satellite",
        "orbit": "Destination",
        "time_offset_seconds": 0,
        "links": [],
        "contact_windows": [
          {"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}
        ]
      }
    ]
  }' > /tmp/selenet-cancel-step1.json
cat /tmp/selenet-cancel-step1.json

echo
echo "[2/6] Creating packet..."
ACK_JSON="$(curl -sS -X POST "${API_BASE_URL}/api/packets" \
  -H 'Content-Type: application/json' \
  -d '{
    "source_node": "GS_CANCEL_TEST",
    "destination_node": "SAT_CANCEL_DST",
    "priority": 1,
    "payload": {"test": "cancel-sim", "seq": 1}
  }')"

echo "${ACK_JSON}"

PACKET_ID="$(printf '%s' "${ACK_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["packet_id"])')"

echo "Packet ID: ${PACKET_ID}"

echo
echo "[3/6] Waiting ${CANCEL_DELAY_SECONDS}s before cancel..."
sleep "${CANCEL_DELAY_SECONDS}"

echo
echo "[4/6] Sending cancel request..."
CANCEL_JSON="$(curl -sS -X POST "${API_BASE_URL}/api/packets/${PACKET_ID}/cancel")"
echo "${CANCEL_JSON}"

echo
echo "[5/6] Polling status for ${POLL_SECONDS}s..."
export API_BASE_URL PACKET_ID POLL_SECONDS
POLL_OUTPUT="$(python3 - <<'PY'
import json
import os
import time
import urllib.request

base = os.environ["API_BASE_URL"]
pid = os.environ["PACKET_ID"]
poll_seconds = int(os.environ["POLL_SECONDS"])

last_status = "NOT_FOUND"
for idx in range(poll_seconds):
    with urllib.request.urlopen(f"{base}/api/packets?limit=300") as response:
        rows = json.load(response)

    row = next((item for item in rows if item.get("packet_id") == pid), None)
    last_status = (row or {}).get("current_status", "NOT_FOUND")
    print(f"t+{idx:02d}s -> {last_status}")
    time.sleep(1)

print(f"FINAL_STATUS={last_status}")
PY
)"

echo "${POLL_OUTPUT}"
FINAL_STATUS="$(printf '%s\n' "${POLL_OUTPUT}" | awk -F= '/^FINAL_STATUS=/{print $2}' | tail -n 1)"

echo
echo "[6/6] Fetching history excerpt..."
HISTORY_JSON="$(python3 - <<'PY'
import json
import os
import urllib.request

base = os.environ["API_BASE_URL"]
pid = os.environ["PACKET_ID"]

with urllib.request.urlopen(f"{base}/api/packets?limit=300") as response:
    rows = json.load(response)

row = next((item for item in rows if item.get("packet_id") == pid), None)

payload = {
    "packet_id": pid,
    "current_status": row.get("current_status") if row else None,
    "route_hops": row.get("route_hops") if row else None,
    "status_history_tail": (row.get("status_history") or [])[-8:] if row else None,
}
print(json.dumps(payload))
PY
)"

export HISTORY_JSON

python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["HISTORY_JSON"])
print(json.dumps(payload, indent=2))
PY

HAS_IN_TRANSIT="$(python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["HISTORY_JSON"])
rows = payload.get("status_history_tail") or []
print("yes" if any((row.get("status") or "").upper() == "IN_TRANSIT" for row in rows) else "no")
PY
)"

HAS_CANCEL_REQUESTED="$(python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["HISTORY_JSON"])
rows = payload.get("status_history_tail") or []
print("yes" if any((row.get("status") or "").upper() == "CANCEL_REQUESTED" for row in rows) else "no")
PY
)"

if [[ "${FINAL_STATUS}" != "CANCELLED" ]]; then
  echo
  echo "FAIL: expected final status CANCELLED, got ${FINAL_STATUS}."
  exit 1
fi

if [[ "${HAS_IN_TRANSIT}" != "yes" ]]; then
  echo
  echo "FAIL: expected at least one IN_TRANSIT hop before cancellation finalization."
  exit 1
fi

if [[ "${HAS_CANCEL_REQUESTED}" != "yes" ]]; then
  echo
  echo "FAIL: expected CANCEL_REQUESTED event in status history."
  exit 1
fi

echo

echo "PASS: packet traversed hops, recorded CANCEL_REQUESTED, and finalized as CANCELLED."
