#!/bin/sh
set -eu

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is unavailable: $1" >&2
    exit 1
  fi
}

api_get() {
  if [ -n "${DRILL_AUTH_TOKEN:-}" ]; then
    curl --fail --silent --oauth2-bearer "$DRILL_AUTH_TOKEN" "${DRILL_BASE_URL}$1"
  else
    curl --fail --silent "${DRILL_BASE_URL}$1"
  fi
}

execution_state() {
  api_get /api/v1/capabilities | jq --raw-output '.execution.enabled'
}

wait_for_state() {
  expected=$1
  elapsed=0
  while [ "$elapsed" -lt "$DRILL_TRANSITION_TIMEOUT_SECONDS" ]; do
    if [ "$(execution_state 2>/dev/null || true)" = "$expected" ]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "Worker readiness did not become $expected before the drill timeout." >&2
  return 1
}

DRILL_BASE_URL=${DRILL_BASE_URL:-http://127.0.0.1:8787}
DRILL_TRANSITION_TIMEOUT_SECONDS=${DRILL_TRANSITION_TIMEOUT_SECONDS:-60}
case "$DRILL_BASE_URL" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *)
    echo 'DRILL_BASE_URL must use a loopback HTTP endpoint.' >&2
    exit 1
    ;;
esac
case "$DRILL_TRANSITION_TIMEOUT_SECONDS" in
  '' | *[!0-9]*)
    echo 'DRILL_TRANSITION_TIMEOUT_SECONDS must be an integer.' >&2
    exit 1
    ;;
esac
if [ "$DRILL_TRANSITION_TIMEOUT_SECONDS" -lt 5 ] || [ "$DRILL_TRANSITION_TIMEOUT_SECONDS" -gt 300 ]; then
  echo 'DRILL_TRANSITION_TIMEOUT_SECONDS must be between 5 and 300.' >&2
  exit 1
fi

require_command curl
require_command docker
require_command jq

restore_worker() {
  docker compose up --detach worker >/dev/null 2>&1 || true
}
trap restore_worker EXIT HUP INT TERM

docker compose up --detach worker >/dev/null
wait_for_state true
docker compose stop --timeout 10 worker >/dev/null
wait_for_state false
curl --fail --silent "${DRILL_BASE_URL}/api/health" >/dev/null
api_get /api/ready >/dev/null
docker compose up --detach worker >/dev/null
wait_for_state true

trap - EXIT HUP INT TERM
echo 'Worker readiness drill passed: execution disabled after heartbeat expiry and recovered after restart.'
