#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:17373}"
TOKEN="${TOKEN:-${PI_REMOTE_CONTROL_DEV_TOKEN:-}}"
PROJECT_ID="${PROJECT_ID:-}"
SESSION_ID="${SESSION_ID:-}"
PAIR_CODE="${PAIR_CODE:-}"
DEVICE_NAME="${DEVICE_NAME:-Smoke Test Device}"
PROMPT="${PROMPT:-Hello from http-smoke-test.sh}"

json() {
  if command -v jq >/dev/null 2>&1; then jq .; else cat; fi
}

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  shift 3 || true

  echo
  echo "### ${method} ${path}"
  if [[ -n "${body}" ]]; then
    curl -sS -X "${method}" "${BASE_URL}${path}" \
      -H "content-type: application/json" "$@" \
      --data "${body}" | json
  else
    curl -sS -X "${method}" "${BASE_URL}${path}" "$@" | json
  fi
}

auth_headers=()
if [[ -n "${TOKEN}" ]]; then
  auth_headers=(-H "authorization: Bearer ${TOKEN}")
fi

request GET /v1/health ""

if [[ -n "${PAIR_CODE}" ]]; then
  request POST /v1/pair/claim \
    "$(printf '{"pairCode":"%s","deviceName":"%s"}' "${PAIR_CODE}" "${DEVICE_NAME}")"
fi

if [[ -z "${TOKEN}" ]]; then
  echo
  echo "TOKEN is not set; skipping authenticated endpoints."
  echo "For local dev, start the server with PI_REMOTE_CONTROL_DEV_TOKEN=test-token and run TOKEN=test-token $0"
  exit 0
fi

request POST /v1/pair/code "" "${auth_headers[@]}"

request GET /v1/projects "" "${auth_headers[@]}"

if [[ -n "${PROJECT_ID}" ]]; then
  request GET "/v1/projects/${PROJECT_ID}/sessions" "" "${auth_headers[@]}"
  request POST "/v1/projects/${PROJECT_ID}/sessions" "" "${auth_headers[@]}"
else
  echo
  echo "PROJECT_ID is not set; skipping project session endpoints."
fi

if [[ -n "${SESSION_ID}" ]]; then
  request GET "/v1/sessions/${SESSION_ID}" "" "${auth_headers[@]}"
  request POST "/v1/sessions/${SESSION_ID}/prompt" \
    "$(printf '{"text":"%s","streamingBehavior":null}' "${PROMPT}")" \
    "${auth_headers[@]}"
  request POST "/v1/sessions/${SESSION_ID}/abort" "" "${auth_headers[@]}"

  if [[ -d node_modules/ws ]]; then
    echo
    echo "### WS /v1/sessions/${SESSION_ID}/stream"
    BASE_URL="${BASE_URL}" TOKEN="${TOKEN}" SESSION_ID="${SESSION_ID}" node --input-type=module <<'NODE'
import WebSocket from "ws";
const wsUrl = process.env.BASE_URL.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + `/v1/sessions/${process.env.SESSION_ID}/stream`;
const socket = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${process.env.TOKEN}` } });
const timeout = setTimeout(() => {
  console.log("(no websocket message within 2s)");
  socket.close();
}, 2000);
socket.on("message", (data) => {
  clearTimeout(timeout);
  console.log(String(data));
  socket.close();
});
socket.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exitCode = 1;
});
NODE
  else
    echo
    echo "node_modules/ws is missing; run npm install to test WebSocket stream."
  fi
else
  echo
  echo "SESSION_ID is not set; skipping session state/prompt/abort/stream endpoints."
fi
