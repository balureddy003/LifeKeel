#!/usr/bin/env bash
# restore.sh — restore a backup.sh archive into a target MongoDB.
#
# Usage:
#   MONGODB_URL=mongodb://... ./scripts/ops/restore.sh <archive> [--drop]
#
#   Encrypted archives (.age) need BACKUP_AGE_IDENTITY=<path to age identity file>.
#   ERASURE_JOURNAL_FILE=<erasure-journal-*.json[.age]> adds the newest
#   journal you hold; required when the target has no data of its own
#   (a fresh disaster-recovery target), see below.
#
# --drop wipes the target DB first (mongorestore --drop). Required when
# restoring into an environment that already has data.
#
# ERASURE RECONCILIATION (R15) — a backup taken before an account deletion
# resurrects erased family data. This script:
#
#   1. Collects every tenant that is being or has been deleted, from the
#      target database (status 'deleting' or 'deleted') and from the
#      erasure journal file. A fresh target has nothing to collect, so the
#      journal file is required there unless ALLOW_RESTORE_WITHOUT_JOURNAL=1.
#   2. Turns maintenance mode on, so the API serves nothing but operator
#      routes while data and tombstones disagree.
#   3. Restores, re-marks every collected tenant 'deleting' (the replay
#      finishes and re-closes them), and runs the erasure replay.
#   4. Turns maintenance mode off only if the replay succeeded.
#
# Local drills only: SKIP_AUTO_REPLAY=1 stops after step 3's re-marking and
# leaves maintenance mode on for the caller to finish.
set -euo pipefail
umask 077

ARCHIVE="${1:?usage: restore.sh <archive> [--drop]}"
DROP="${2:-}"
: "${MONGODB_URL:?MONGODB_URL is required}"
MONGODB_DB="${MONGODB_DB:-lifekeel}"

if [ ! -f "$ARCHIVE" ]; then
  echo "Archive not found: $ARCHIVE" >&2
  exit 1
fi

decrypt() {
  local file="$1"
  if [[ "$file" == *.age ]]; then
    : "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is required for an encrypted file}"
    age -d -i "$BACKUP_AGE_IDENTITY" "$file"
  else
    cat "$file"
  fi
}

mongo_eval() {
  mongosh "$MONGODB_URL" --quiet --eval "const d = db.getSiblingDB('$MONGODB_DB'); $1"
}

# 1. Erasure set, gathered before anything is overwritten.
FROM_TARGET="$(mongo_eval "console.log(JSON.stringify(d.tenants.distinct('tenant_id', { status: { \$in: ['deleting', 'deleted'] } })))")"
TARGET_TENANTS="$(mongo_eval "console.log(d.tenants.countDocuments({}))")"
FROM_JOURNAL="[]"
if [ -n "${ERASURE_JOURNAL_FILE:-}" ]; then
  FROM_JOURNAL="$(decrypt "$ERASURE_JOURNAL_FILE")"
elif [ "$TARGET_TENANTS" = "0" ] && [ "${ALLOW_RESTORE_WITHOUT_JOURNAL:-}" != "1" ]; then
  echo "The target has no tenants, so it cannot say which accounts were erased." >&2
  echo "Pass ERASURE_JOURNAL_FILE (newest erasure-journal-*.json from backup.sh)," >&2
  echo "or ALLOW_RESTORE_WITHOUT_JOURNAL=1 if you have confirmed no deletions happened after this backup." >&2
  exit 1
fi
echo "Erasure set: target=$FROM_TARGET journal=$FROM_JOURNAL"

# 2. No traffic while the restored data disagrees with the erasure set.
set_maintenance() {
  mongo_eval "d.platform_config.updateOne({ key: 'global' }, { \$set: { maintenance_mode: $1, updated_at: new Date() } }, { upsert: true })" >/dev/null
}
set_maintenance true

DROP_FLAG=""
[ "$DROP" = "--drop" ] && DROP_FLAG="--drop"

decrypt "$ARCHIVE" | mongorestore --uri="$MONGODB_URL" --db="$MONGODB_DB" --archive --gzip --quiet $DROP_FLAG

# The restored platform_config may have maintenance off; force it back on.
set_maintenance true

# 3. Re-mark every erased tenant. 'deleting' makes the replay finish the
# wipe and close the receipt, whichever state the backup had.
mongo_eval "const ids = [...new Set([...$FROM_TARGET, ...$FROM_JOURNAL])]; const r = d.tenants.updateMany({ tenant_id: { \$in: ids }, status: { \$ne: 'deleted' } }, { \$set: { status: 'deleting', updated_at: new Date() } }); console.log('re-marked for erasure: ' + r.modifiedCount + ' of ' + ids.length)"

if [ "${SKIP_AUTO_REPLAY:-}" = "1" ]; then
  echo "Restore complete into $MONGODB_DB. Maintenance mode is ON; run the erasure replay, then turn it off."
  exit 0
fi

# 4. Replay, then reopen. The connection string is never echoed (R20).
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if (cd "$REPO_ROOT" && pnpm --filter @lifekeel/api exec tsx src/jobs/erasure-replay.ts); then
  set_maintenance false
  echo "Restore and erasure replay complete into $MONGODB_DB. Maintenance mode is off."
else
  echo "Erasure replay FAILED. Maintenance mode stays ON. Fix and re-run:" >&2
  echo "  pnpm --filter @lifekeel/api exec tsx src/jobs/erasure-replay.ts" >&2
  exit 1
fi
