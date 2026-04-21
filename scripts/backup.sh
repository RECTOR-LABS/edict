#!/usr/bin/env bash
# Nightly pg_dump of the Edict production database.
#
# Intended as a cron job on the VPS. Example crontab:
#   0 3 * * *  /home/edict/apps/edict/scripts/backup.sh >> /home/edict/apps/edict/backups/backup.log 2>&1
#
# Behavior:
#   - Writes /<repo>/backups/YYYY-MM-DD.sql.gz
#   - Prunes dumps older than 14 days locally
#   - Off-VPS replication is handled by a separate rsync/restic job (see runbook)
#
# Safety:
#   - set -euo pipefail aborts on any failure
#   - pipefail catches pg_dump errors that would otherwise be masked by gzip's success
#   - If run twice the same day, the second run overwrites the first (same-day
#     dumps are considered idempotent)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
BACKUP_DIR="$REPO_ROOT/backups"

STAMP="$(date +%F)"
OUT="$BACKUP_DIR/$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[backup] ERROR: compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U edict_admin -d edict --no-owner --no-privileges \
  | gzip > "$OUT"

# Drop dumps older than 14 days. Off-VPS replication should run before this on
# the rsync host, so this is a local-retention policy only.
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +14 -delete

echo "[backup] done $STAMP — $(du -h "$OUT" | awk '{print $1}')"
