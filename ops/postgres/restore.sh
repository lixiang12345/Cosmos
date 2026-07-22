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
: "${EXPECTED_MIGRATION_VERSION:?EXPECTED_MIGRATION_VERSION is required.}"
: "${EXPECTED_MIGRATION_COUNT:?EXPECTED_MIGRATION_COUNT is required.}"

case "$EXPECTED_MIGRATION_COUNT" in
  '' | *[!0-9]* | 0)
    echo 'EXPECTED_MIGRATION_COUNT must be a positive integer.' >&2
    exit 1
    ;;
esac

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

verification=$(psql \
  --dbname="$RESTORE_DATABASE_URL" \
  --no-psqlrc \
  --tuples-only \
  --no-align \
  --set=ON_ERROR_STOP=1 \
  --field-separator='|' \
  --command="
    WITH required_tables(name, force_rls) AS (
      VALUES
        ('cosmos_organizations', true),
        ('cosmos_sessions', true),
        ('cosmos_file_versions', true),
        ('cosmos_organization_quotas', true),
        ('cosmos_organization_rate_limit_windows', true),
        ('cosmos_object_storage_gc_runs', false)
    ), table_state AS (
      SELECT
        count(c.oid) FILTER (WHERE n.nspname = 'public') AS present_count,
        count(c.oid) FILTER (
          WHERE n.nspname = 'public'
            AND required_tables.force_rls
            AND c.relrowsecurity
            AND c.relforcerowsecurity
        ) AS forced_rls_count
      FROM required_tables
      LEFT JOIN pg_catalog.pg_class c
        ON c.relname = required_tables.name AND c.relkind = 'r'
      LEFT JOIN pg_catalog.pg_namespace n
        ON n.oid = c.relnamespace
    )
    SELECT
      (SELECT count(*) FROM cosmos_schema_migrations),
      (SELECT max(version) FROM cosmos_schema_migrations),
      table_state.present_count,
      table_state.forced_rls_count,
      has_table_privilege('cosmos_api_runtime', 'cosmos_sessions', 'SELECT')
        AND has_table_privilege('cosmos_api_runtime', 'cosmos_file_versions', 'SELECT')
        AND has_table_privilege('cosmos_api_runtime', 'cosmos_organization_quotas', 'SELECT'),
      has_table_privilege('cosmos_worker_runtime', 'cosmos_organization_quotas', 'SELECT'),
      (SELECT count(*) FROM cosmos_organizations organization
        LEFT JOIN cosmos_organization_quotas quota ON quota.organization_id = organization.id
        WHERE quota.organization_id IS NULL),
      (SELECT count(*) FROM cosmos_file_versions
        WHERE (storage_backend = 'inline' AND (content IS NULL OR object_key IS NOT NULL))
          OR (storage_backend = 'object' AND (content IS NOT NULL OR object_key IS NULL)))
    FROM table_state
  ")

old_ifs=$IFS
IFS='|'
set -- $verification
IFS=$old_ifs
migration_count=${1:-}
latest_migration=${2:-}
required_table_count=${3:-}
forced_rls_count=${4:-}
api_runtime_access=${5:-}
worker_runtime_access=${6:-}
organizations_without_quota=${7:-}
invalid_file_versions=${8:-}

if [ "$migration_count" != "$EXPECTED_MIGRATION_COUNT" ] \
  || [ "$latest_migration" != "$EXPECTED_MIGRATION_VERSION" ]; then
  echo 'Restore verification failed: migration set does not match the application release.' >&2
  exit 1
fi
if [ "$required_table_count" != '6' ] || [ "$forced_rls_count" != '5' ]; then
  echo 'Restore verification failed: required tables or FORCE RLS protections are missing.' >&2
  exit 1
fi
if [ "$api_runtime_access" != 't' ] || [ "$worker_runtime_access" != 't' ]; then
  echo 'Restore verification failed: runtime role privileges are incomplete.' >&2
  exit 1
fi
if [ "$organizations_without_quota" != '0' ] || [ "$invalid_file_versions" != '0' ]; then
  echo 'Restore verification failed: restored quota or FileVersion invariants are invalid.' >&2
  exit 1
fi

echo "Restore verified for database $actual_database_name ($migration_count migrations; RLS, ACL, quota, and FileVersion invariants passed)"
