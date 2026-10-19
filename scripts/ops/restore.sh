#!/usr/bin/env bash
# restore.sh — restore a backup.sh archive into a target MongoDB.
#
# Usage:
#   MONGODB_URL=mongodb://localhost:27017 ./scripts/ops/restore.sh <archive> [--drop]
#
# --drop wipes the target DB first (mongorestore --drop). Required when
# restoring into an environment that already has data.
#
# ERASURE RECONCILIATION — a backup taken before an account deletion
# resurrects erased family data. Two paths:
#
#   * Without --drop, mongorestore skips duplicate _ids, so tombstoned
#     tenants (status:'deleted') keep their marker and the erasure-replay
#     job re-wipes whatever data came back.
#
#   * With --drop, the tombstone row itself is replaced by the backup's
#     'active' version. This script therefore exports the tombstoned
#     tenant_ids BEFORE dropping and re-marks them after the restore —
#     skipping that step silently un-deletes accounts.
#
# Either way, run the replay before reopening traffic:
#   MONGODB_URL=... pnpm --filter @lifekeel/api exec tsx src/jobs/erasure-replay.ts
set -euo pipefail

ARCHIVE="${1:?usage: restore.sh <archive> [--drop]}"
DROP="${2:-}"
: "${MONGODB_URL:?MONGODB_URL is required}"
MONGODB_DB="${MONGODB_DB:-lifekeel}"

if [ ! -f "$ARCHIVE" ]; then
  echo "Archive not found: $ARCHIVE" >&2
  exit 1
fi

TOMBSTONE_FILE=""
if [ "$DROP" = "--drop" ]; then
  TOMBSTONE_FILE="$(mktemp -t lifekeel-tombstones).json"
  echo "Exporting tombstoned tenant_ids before --drop → $TOMBSTONE_FILE"
  mongosh "${MONGODB_URL%/}/$MONGODB_DB" --quiet --eval \
    'const ids = db.tenants.distinct("tenant_id", { status: "deleted" }); console.log(JSON.stringify(ids))' \
    > "$TOMBSTONE_FILE"
  echo "  $(cat "$TOMBSTONE_FILE")"
fi

DROP_FLAG=""
if [ "$DROP" = "--drop" ]; then
  DROP_FLAG="--drop"
fi

mongorestore --uri="$MONGODB_URL" --db="$MONGODB_DB" --archive="$ARCHIVE" --gzip $DROP_FLAG

if [ -n "$TOMBSTONE_FILE" ]; then
  echo "Re-applying tombstones lost to --drop"
  IDS="$(cat "$TOMBSTONE_FILE")"
  mongosh "${MONGODB_URL%/}/$MONGODB_DB" --quiet --eval \
    "const ids = $IDS; const r = db.tenants.updateMany({ tenant_id: { \$in: ids } }, { \$set: { status: 'deleted' } }); console.log('re-tombstoned: ' + r.modifiedCount)"
  rm -f "$TOMBSTONE_FILE"
fi

echo "Restore complete into $MONGODB_DB."
echo "Next: run erasure replay before serving traffic:"
echo "  MONGODB_URL=$MONGODB_URL pnpm --filter @lifekeel/api exec tsx src/jobs/erasure-replay.ts"
