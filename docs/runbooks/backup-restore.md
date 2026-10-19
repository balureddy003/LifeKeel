# Runbook: backup & restore (baseline)

Owner: platform/on-call. Cadence: restore drill once per quarter (first
evidence below), or after any change to `erasure.ts`, `restore.sh`, or the
MongoDB version.

## Data classes → RPO/RTO

| Class | Examples | RPO | RTO | Notes |
|---|---|---|---|---|
| Authority — family-authored | `users`, `family_*`, `documents(.files)`, `legacy_*`, `external_accounts`, `pending_trades` | last backup | hours (single restore) | The only data that cannot be rebuilt. PITR is the upgrade path; scheduled archives until then. |
| Authority — receipts & tombstones | `action_receipts`, `audit_log`, `tenants` (status:'deleted') | last backup | same restore | Tombstones double as the erasure ledger — preserve them on every restore. |
| Derived — rebuildable | `metrics_daily`, `llm_cache`, scorer/model versions, calibration state, feed materializations | n/a | n/a | Excluded from backup scope in principle; today they ride along in the whole-db archive (cheap at current size). Rebuilds from authority data + eval jobs. |
| Platform/operator | `prompt_versions`, `detector_eval_baselines`, billing ledger | last backup | same restore | Billing rows are the financial record — never lost, never erased. |

## Backup

```
MONGODB_URL=... ./scripts/ops/backup.sh [backup_dir]
```

Writes a timestamped `mongodump --archive --gzip` of `$MONGODB_DB`
(default `lifekeel`). Until managed PITR lands, schedule this daily off-box
and keep ≥30 days.

## Restore

```
MONGODB_URL=... ./scripts/ops/restore.sh <archive> [--drop]
```

- **Without `--drop`** (merge into a live DB): existing docs win on `_id`
  conflicts, so tombstoned tenants keep `status:'deleted'` — the erasure
  replay below is still required to re-wipe resurrected rows.
- **With `--drop`** (disaster restore): the script exports tombstoned
  `tenant_id`s before dropping and re-marks them after — a stale backup
  otherwise un-deletes accounts by restoring `status:'active'`.
- **Then, always, before reopening traffic:**
  ```
  MONGODB_URL=... pnpm --filter @lifekeel/api exec tsx src/jobs/erasure-replay.ts
  ```
  The daily 04:30 cron (`withCronLock 'erasure-replay'` in server.ts) covers
  it automatically — the manual run just doesn't wait for it.

## Verification after restore

1. `/health/ready` on a canary deploy; migrations report the expected
   version (intent 08 gate).
2. `db.tenants.countDocuments({status:'deleted'})` matches the pre-restore
   count; replay reports `tenants_replayed` ≥ 0 with no errors.
3. Spot-check one live tenant end-to-end (login → feed → one insight).

## Restore drill — first evidence (2026-10-19)

`scripts/ops/restore-drill.ts` is the executable drill: seeds a scratch
`mongodb-memory-server` DB with a live and a to-be-deleted tenant, runs the
real `backup.sh`, deletes+tombstones, runs the real `restore.sh --drop` on
the pre-deletion archive, then `runErasureReplay`.

Result — PASSED (2.0s on a 14-doc scratch DB):

- `--drop` restored the pre-deletion archive: 7 docs for the deleted tenant
  resurrected, including the `status:'active'` tenants row.
- `restore.sh` re-applied the tombstone (export-before-drop worked).
- `runErasureReplay` re-wiped all 7 resurrected docs.
- The live tenant's 7 docs were untouched.

RTO interpretation: at scratch scale the whole cycle is seconds; the number
that matters at production scale is `mongorestore` throughput on the real
archive size — re-run the drill against a prod-size dump quarterly and
record wall time here.

Known limit: a restore of a backup taken *after* deletion is already safe
(data was wiped before snapshot). A *pre*-deletion backup is covered by
tombstone preservation + replay. The residual hole is a `--drop` restore
performed **without** restore.sh's tombstone step (raw mongorestore by
hand) — the runbook above is the control; per-tenant DEK crypto-shredding
(intent 04, Stage B4) removes the dependency on operator discipline.
