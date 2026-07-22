#!/bin/sh
set -eu

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is unavailable: $1" >&2
    exit 1
  fi
}

require_positive_integer() {
  value=$1
  name=$2
  case "$value" in
    '' | *[!0-9]* | 0)
      echo "$name must be a positive integer." >&2
      exit 1
      ;;
  esac
}

query_scalar() {
  psql \
    --dbname="$DATABASE_URL" \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command="$1"
}

: "${DATABASE_URL:?DATABASE_URL is required.}"
: "${EXPECTED_DATABASE_NAME:?EXPECTED_DATABASE_NAME is required.}"
: "${PITR_MODE:?PITR_MODE must be archive or managed.}"
: "${TARGET_RPO_SECONDS:?TARGET_RPO_SECONDS is required.}"

case "$EXPECTED_DATABASE_NAME" in
  '' | postgres | template0 | template1)
    echo 'EXPECTED_DATABASE_NAME is not a permitted PITR source.' >&2
    exit 1
    ;;
esac
case "$PITR_MODE" in
  archive | managed) ;;
  *)
    echo 'PITR_MODE must be archive or managed.' >&2
    exit 1
    ;;
esac
require_positive_integer "$TARGET_RPO_SECONDS" TARGET_RPO_SECONDS
if [ "$TARGET_RPO_SECONDS" -gt 300 ]; then
  echo 'TARGET_RPO_SECONDS must not exceed the Relay 300-second RPO objective.' >&2
  exit 1
fi

require_command psql

actual_database_name=$(query_scalar 'SELECT current_database()')
if [ "$actual_database_name" != "$EXPECTED_DATABASE_NAME" ]; then
  echo 'The connected database does not match EXPECTED_DATABASE_NAME.' >&2
  exit 1
fi

server_version_num=$(query_scalar "SELECT current_setting('server_version_num')")
wal_level=$(query_scalar "SELECT current_setting('wal_level')")
full_page_writes=$(query_scalar "SELECT current_setting('full_page_writes')")
case "$server_version_num" in
  '' | *[!0-9]*)
    echo 'PostgreSQL returned an invalid server_version_num.' >&2
    exit 1
    ;;
esac
if [ "$server_version_num" -lt 170000 ]; then
  echo 'Relay production PITR requires PostgreSQL 17 or newer.' >&2
  exit 1
fi
case "$wal_level" in
  replica | logical) ;;
  *)
    echo 'PITR preflight failed: wal_level must be replica or logical.' >&2
    exit 1
    ;;
esac
if [ "$full_page_writes" != 'on' ]; then
  echo 'PITR preflight failed: full_page_writes must be enabled.' >&2
  exit 1
fi

if [ "$PITR_MODE" = 'managed' ]; then
  : "${PITR_MANAGED_PROVIDER:?PITR_MANAGED_PROVIDER is required in managed mode.}"
  : "${PITR_MANAGED_EVIDENCE_ID:?PITR_MANAGED_EVIDENCE_ID is required in managed mode.}"
  : "${PITR_RETENTION_SECONDS:?PITR_RETENTION_SECONDS is required in managed mode.}"
  require_positive_integer "$PITR_RETENTION_SECONDS" PITR_RETENTION_SECONDS
  if [ "$PITR_RETENTION_SECONDS" -lt "$TARGET_RPO_SECONDS" ]; then
    echo 'PITR_RETENTION_SECONDS must be at least TARGET_RPO_SECONDS.' >&2
    exit 1
  fi
  echo "Managed PITR preflight passed for database $actual_database_name (RPO ${TARGET_RPO_SECONDS}s; provider evidence supplied)"
  exit 0
fi

archive_mode=$(query_scalar "SELECT current_setting('archive_mode')")
archive_command=$(query_scalar "SELECT current_setting('archive_command')")
archive_library=$(query_scalar "SELECT current_setting('archive_library', true)")
archive_timeout=$(query_scalar "SELECT EXTRACT(EPOCH FROM current_setting('archive_timeout')::interval)::bigint")

case "$archive_mode" in
  on | always) ;;
  *)
    echo 'PITR preflight failed: archive_mode must be on or always.' >&2
    exit 1
    ;;
esac
if { [ -z "$archive_command" ] || [ "$archive_command" = '(disabled)' ]; } \
  && [ -z "$archive_library" ]; then
  echo 'PITR preflight failed: archive_command or archive_library must be configured.' >&2
  exit 1
fi
case "$archive_timeout" in
  '' | *[!0-9]*)
    echo 'PostgreSQL returned an invalid archive_timeout.' >&2
    exit 1
    ;;
esac
if [ "$archive_timeout" -eq 0 ] || [ "$archive_timeout" -gt "$TARGET_RPO_SECONDS" ]; then
  echo 'PITR preflight failed: archive_timeout must be non-zero and within the RPO.' >&2
  exit 1
fi

latest_archive_failed=$(query_scalar "
  SELECT CASE
    WHEN last_failed_wal IS NOT NULL
      AND (last_archived_wal IS NULL OR last_failed_time > last_archived_time)
    THEN 'true' ELSE 'false' END
  FROM pg_stat_archiver
")
if [ "$latest_archive_failed" = 'true' ]; then
  echo 'PITR preflight failed: the latest WAL archive attempt failed.' >&2
  exit 1
fi

if [ "${PITR_TRIGGER_WAL_SWITCH:-}" = 'verify-approved' ]; then
  verify_timeout=${PITR_VERIFY_TIMEOUT_SECONDS:-30}
  require_positive_integer "$verify_timeout" PITR_VERIFY_TIMEOUT_SECONDS
  if [ "$verify_timeout" -gt 60 ]; then
    echo 'PITR_VERIFY_TIMEOUT_SECONDS must not exceed 60.' >&2
    exit 1
  fi
  target_wal=$(query_scalar 'SELECT pg_walfile_name(pg_switch_wal())')
  verified=false
  elapsed=0
  while [ "$elapsed" -lt "$verify_timeout" ]; do
    last_archived_wal=$(query_scalar "SELECT COALESCE(last_archived_wal, '') FROM pg_stat_archiver")
    if [ "$last_archived_wal" = "$target_wal" ]; then
      verified=true
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if [ "$verified" != 'true' ]; then
    echo 'PITR preflight failed: the forced WAL segment was not archived before timeout.' >&2
    exit 1
  fi
  echo "Continuous WAL archive preflight passed for database $actual_database_name (RPO ${TARGET_RPO_SECONDS}s; live archive verified)"
else
  echo "Continuous WAL archive configuration passed for database $actual_database_name (RPO ${TARGET_RPO_SECONDS}s; live archive not requested)"
fi
