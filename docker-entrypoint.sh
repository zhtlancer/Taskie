#!/bin/sh
# Runs Taskie as an unprivileged user.
#
# Started as root (the default), it first hands the data directories to PUID:PGID (1000:1000
# unless set) so that existing installs whose files were created by root keep working, then drops
# privileges for good. Keep the default or use a dedicated non-admin account: whatever uid runs
# here is what a compromised container would hold on the host.
# Started as a non-root user (compose `user:`), it runs unchanged and the data directory must
# already be writable by that user.
set -eu

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
case "$PUID$PGID" in
  *[!0-9]*|'') echo "PUID and PGID must be numeric (got PUID=$PUID PGID=$PGID)" >&2; exit 1 ;;
esac
if [ "$PUID" = "0" ]; then
  echo "PUID=0: running as root" >&2
  exec "$@"
fi

# Only touch what is not already owned, so restarts stay fast with many photos and backups.
own_dir() {
  [ -n "$1" ] || return 0
  mkdir -p "$1"
  find "$1" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} +
}
own_dir /app/data
own_dir "$(dirname "${DATABASE_PATH:-/app/data/data.sqlite}")"
own_dir "${UPLOAD_DIR:-}"
own_dir "${BACKUP_DIR:-}"

exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
