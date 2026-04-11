#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8001}"
DURATION_SECONDS="${DURATION_SECONDS:-120}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-1.2}"
REFRESH_NODES_EVERY="${REFRESH_NODES_EVERY:-10}"
EARTH_NODE_IDS="${EARTH_NODE_IDS:-}"
MOON_NODE_IDS="${MOON_NODE_IDS:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ARGS=(
  --api-base-url "${API_BASE_URL}"
  --duration "${DURATION_SECONDS}"
  --interval "${INTERVAL_SECONDS}"
  --refresh-nodes-every "${REFRESH_NODES_EVERY}"
)

if [[ -n "${EARTH_NODE_IDS}" ]]; then
  IFS=',' read -r -a EARTH_LIST <<< "${EARTH_NODE_IDS}"
  for NODE_ID in "${EARTH_LIST[@]}"; do
    CLEANED="$(echo "${NODE_ID}" | xargs)"
    if [[ -n "${CLEANED}" ]]; then
      ARGS+=(--earth-node "${CLEANED}")
    fi
  done
fi

if [[ -n "${MOON_NODE_IDS}" ]]; then
  IFS=',' read -r -a MOON_LIST <<< "${MOON_NODE_IDS}"
  for NODE_ID in "${MOON_LIST[@]}"; do
    CLEANED="$(echo "${NODE_ID}" | xargs)"
    if [[ -n "${CLEANED}" ]]; then
      ARGS+=(--moon-node "${CLEANED}")
    fi
  done
fi

python3 "${SCRIPT_DIR}/simulate_earth_moon_traffic.py" "${ARGS[@]}" "$@"
