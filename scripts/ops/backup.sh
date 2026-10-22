#!/usr/bin/env bash
# backup.sh — take a timestamped, encrypted MongoDB backup archive.
#
# Usage:
#   MONGODB_URL=mongodb://... BACKUP_AGE_RECIPIENT=age1... ./scripts/ops/backup.sh [backup_dir]
#
# Writes <backup_dir>/lifekeel-<UTC timestamp>.archive.age: mongodump
# --archive --gzip piped straight into `age`, so no plaintext dump touches
# disk (R20). Compression is not encryption: the archive holds document
# bytes, family records and wrapped tenant keys. Keep the age identity
# (private key) in a different place from the archives — a secrets manager,
# not the backup bucket.
#
# Alongside it, erasure-journal-<stamp>.json.age lists every tenant that is
# being or has been deleted. Store journals somewhere independent of the
# database (they are what restore.sh uses to keep erased accounts erased on
# a fresh disaster-recovery target, R15).
#
# Local drills only: ALLOW_UNENCRYPTED_BACKUP=1 writes a plain .archive.
#
# Scope note (docs/intents/05): this dumps the whole database. Derived,
# rebuildable collections (llm_cache, metrics_daily, feed materializations)
# travel with it — cheap at current size; revisit exclusion flags if dumps
# get expensive. Authority data (family-authored docs, receipts, tombstones)
# is what matters.
set -euo pipefail
umask 077

BACKUP_DIR="${1:-backups}"
: "${MONGODB_URL:?MONGODB_URL is required (e.g. mongodb://localhost:27017)}"
MONGODB_DB="${MONGODB_DB:-lifekeel}"

if [ -z "${BACKUP_AGE_RECIPIENT:-}" ] && [ "${ALLOW_UNENCRYPTED_BACKUP:-}" != "1" ]; then
  echo "BACKUP_AGE_RECIPIENT is required (an age public key). Backups are never written unencrypted." >&2
  echo "For a local drill only, set ALLOW_UNENCRYPTED_BACKUP=1." >&2
  exit 1
fi
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && ! command -v age >/dev/null 2>&1; then
  echo "age is not installed (https://age-encryption.org)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

encrypt() {
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then age -r "$BACKUP_AGE_RECIPIENT"; else cat; fi
}
SUFFIX=""
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] && SUFFIX=".age"

OUT="$BACKUP_DIR/lifekeel-$STAMP.archive$SUFFIX"
mongodump --uri="$MONGODB_URL" --db="$MONGODB_DB" --archive --gzip --quiet | encrypt > "$OUT"
chmod 600 "$OUT"

JOURNAL="$BACKUP_DIR/erasure-journal-$STAMP.json$SUFFIX"
mongosh "$MONGODB_URL" --quiet --eval \
  "const d = db.getSiblingDB('$MONGODB_DB'); console.log(JSON.stringify(d.tenants.distinct('tenant_id', { status: { \$in: ['deleting', 'deleted'] } })))" \
  | encrypt > "$JOURNAL"
chmod 600 "$JOURNAL"

echo "Backup written: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Erasure journal: $JOURNAL"
