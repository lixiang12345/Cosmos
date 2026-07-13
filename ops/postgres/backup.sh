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

: "${DATABASE_URL:?DATABASE_URL is required.}"
: "${BACKUP_PATH:?BACKUP_PATH is required and must be an absolute path.}"

case "$BACKUP_PATH" in
  /*) ;;
  *)
    echo 'BACKUP_PATH must be absolute.' >&2
    exit 1
    ;;
esac

require_command awk
require_command mktemp
require_command pg_dump
require_command pg_restore

backup_directory=$(dirname "$BACKUP_PATH")
if [ ! -d "$backup_directory" ]; then
  echo "Backup directory does not exist: $backup_directory" >&2
  exit 1
fi
if [ -e "$BACKUP_PATH" ] || [ -e "${BACKUP_PATH}.sha256" ]; then
  echo 'Refusing to overwrite an existing backup or checksum.' >&2
  exit 1
fi

umask 077
temporary_backup=$(mktemp "${BACKUP_PATH}.tmp.XXXXXX")
temporary_checksum=$(mktemp "${BACKUP_PATH}.sha256.tmp.XXXXXX")
cleanup() {
  rm -f "$temporary_backup" "$temporary_checksum"
}
trap cleanup EXIT HUP INT TERM

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --file="$temporary_backup"
pg_restore --list "$temporary_backup" >/dev/null

checksum=$(sha256_file "$temporary_backup")
printf '%s  %s\n' "$checksum" "$(basename "$BACKUP_PATH")" >"$temporary_checksum"
chmod 600 "$temporary_backup" "$temporary_checksum"
mv "$temporary_backup" "$BACKUP_PATH"
mv "$temporary_checksum" "${BACKUP_PATH}.sha256"
trap - EXIT HUP INT TERM

echo "Verified logical backup created at $BACKUP_PATH"
