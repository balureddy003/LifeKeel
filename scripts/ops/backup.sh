#!/usr/bin/env bash
# backup.sh — take a timestamped MongoDB backup archive.
#
# Usage:
#   MONGODB_URL=mongodb://localhost:27017 ./scripts/ops/backup.sh [backup_dir]
#
# Writes <backup_dir>/lifekeel-<UTC timestamp>.archive (mongodump --archive,
# single file, gzip). Default backup_dir: ./backups (gitignored — add it if
# it isn't).
#
# Scope note (docs/intents/05): this dumps the whole database. Derived,
# rebuildable collections (llm_cache, metrics_daily, feed materializations)
# travel with it — cheap at current size; revisit exclusion flags if dumps
# get expensive. Authority data (family-authored docs, receipts, tombstones)
# is what matters.
set -euo pipefail

BACKUP_DIR="${1:-backups}"
: "${MONGODB_URL:?MONGODB_URL is required (e.g. mongodb://localhost:27017)}"
MONGODB_DB="${MONGODB_DB:-lifekeel}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/lifekeel-$STAMP.archive"

mongodump --uri="$MONGODB_URL" --db="$MONGODB_DB" --archive="$OUT" --gzip
echo "Backup written: $OUT ($(du -h "$OUT" | cut -f1))"
