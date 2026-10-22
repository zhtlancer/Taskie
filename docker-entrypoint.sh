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

DATA_DIRS="/app/data $(dirname "${DATABASE_PATH:-/app/data/data.sqlite}") ${UPLOAD_DIR:-} ${BACKUP_DIR:-}"

# Fail at start with a clear message instead of a database or upload error later on.
unwritable() {
  echo "数据目录 $1 不可写（运行用户 uid $2）。请检查挂载是否为只读、NAS 共享文件夹权限，或调整 PUID/PGID / compose 的 user: 设置。" >&2
  echo "Data directory $1 is not writable by uid $2: check for a read-only mount, the NAS share permissions, or PUID/PGID / user:." >&2
  exit 1
}

if [ "$(id -u)" != "0" ]; then
  for dir in $DATA_DIRS; do
    mkdir -p "$dir" 2>/dev/null || true
    [ -w "$dir" ] || unwritable "$dir" "$(id -u)"
  done
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
# A read-only or root-squashed share cannot be chowned; the writability check below explains it.
own_dir() {
  [ -n "$1" ] || return 0
  mkdir -p "$1" 2>/dev/null || true
  find "$1" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
  setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- test -w "$1" || unwritable "$1" "$PUID"
}
for dir in $DATA_DIRS; do own_dir "$dir"; done

exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
