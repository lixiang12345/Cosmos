#!/bin/sh
set -eu

BASE_URL=${DRILL_BASE_URL:-http://127.0.0.1:8787}
case "$BASE_URL" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) echo 'DRILL_BASE_URL must use a loopback HTTP endpoint.' >&2; exit 1 ;;
esac

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command is unavailable: $1" >&2; exit 1; }
}
require_command curl
require_command docker

restore_runtime() {
  docker compose up --detach postgres api worker web >/dev/null 2>&1 || true
}
trap restore_runtime EXIT HUP INT TERM

status() {
  curl --max-time 5 --silent --output /dev/null --write-out '%{http_code}' "$BASE_URL$1"
}

wait_for_status() {
  path=$1
  expected=$2
  elapsed=0
  while [ "$elapsed" -lt 60 ]; do
    [ "$(status "$path" 2>/dev/null || true)" = "$expected" ] && return 0
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "Expected $path to return HTTP $expected before the drill timeout." >&2
  return 1
}

[ "$(status /api/health)" = 200 ]
[ "$(status /api/ready)" = 200 ]
docker compose stop --timeout 10 postgres >/dev/null
wait_for_status /api/ready 503
[ "$(status /api/health)" = 200 ]
docker compose up --detach postgres >/dev/null
wait_for_status /api/ready 200

trap - EXIT HUP INT TERM
echo 'Database readiness drill passed: health stayed available, ready failed closed, and recovered.'
