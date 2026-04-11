#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8001}"
DURATION_SECONDS="${DURATION_SECONDS:-120}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-1.4}"
CANCEL_PROBABILITY="${CANCEL_PROBABILITY:-0.28}"
REFRESH_NODES_EVERY="${REFRESH_NODES_EVERY:-12}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

python3 "${SCRIPT_DIR}/simulate_live_traffic.py" \
  --api-base-url "${API_BASE_URL}" \
  --duration "${DURATION_SECONDS}" \
  --interval "${INTERVAL_SECONDS}" \
  --cancel-prob "${CANCEL_PROBABILITY}" \
  --refresh-nodes-every "${REFRESH_NODES_EVERY}" \
  "$@"
