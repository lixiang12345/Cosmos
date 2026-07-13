#!/bin/sh
set -eu

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is unavailable: $1" >&2
    exit 1
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo 'A SHA-256 implementation (sha256sum or shasum) is required.' >&2
    exit 1
  fi
}

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required.}"
: "${BACKUP_PATH:?BACKUP_PATH is required and must be an absolute path.}"
: "${EXPECTED_DATABASE_NAME:?EXPECTED_DATABASE_NAME is required.}"

if [ "${ALLOW_DESTRUCTIVE_RESTORE:-}" != 'restore-approved' ]; then
  echo 'Set ALLOW_DESTRUCTIVE_RESTORE=restore-approved after reviewing the target database.' >&2
  exit 1
fi
case "$BACKUP_PATH" in
  /*) ;;
  *)
    echo 'BACKUP_PATH must be absolute.' >&2
    exit 1
    ;;
esac
case "$EXPECTED_DATABASE_NAME" in
  '' | postgres | template0 | template1)
    echo 'EXPECTED_DATABASE_NAME is not a permitted restore target.' >&2
    exit 1
    ;;
esac

require_command awk
require_command pg_restore
require_command psql

if [ ! -f "$BACKUP_PATH" ] || [ ! -f "${BACKUP_PATH}.sha256" ]; then
  echo 'The backup and its .sha256 checksum must both exist.' >&2
  exit 1
fi

expected_checksum=$(awk 'NR == 1 { print $1 }' "${BACKUP_PATH}.sha256")
actual_checksum=$(sha256_file "$BACKUP_PATH")
if [ -z "$expected_checksum" ] || [ "$actual_checksum" != "$expected_checksum" ]; then
  echo 'Backup checksum verification failed.' >&2
  exit 1
fi
pg_restore --list "$BACKUP_PATH" >/dev/null

actual_database_name=$(psql \
  --dbname="$RESTORE_DATABASE_URL" \
  --no-psqlrc \
  --tuples-only \
  --no-align \
  --set=ON_ERROR_STOP=1 \
  --command='SELECT current_database()')
if [ "$actual_database_name" != "$EXPECTED_DATABASE_NAME" ]; then
  echo 'The connected database does not match EXPECTED_DATABASE_NAME.' >&2
  exit 1
fi

pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --single-transaction \
  --exit-on-error \
  "$BACKUP_PATH"

migration_count=$(psql \
  --dbname="$RESTORE_DATABASE_URL" \
  --no-psqlrc \
  --tuples-only \
  --no-align \
  --set=ON_ERROR_STOP=1 \
  --command='SELECT count(*) FROM relay_schema_migrations')
if [ "$migration_count" -lt 1 ]; then
  echo 'Restore verification failed: no Relay migrations were restored.' >&2
  exit 1
fi

echo "Restore verified for database $actual_database_name ($migration_count migrations)"
