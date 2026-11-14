# Backup policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-034 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | SRE / on-call lead (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.8.13, A.5.30, A.8.10. Procedure: `docs/runbooks/backup-restore.md`.

## Statements

1. Authority data (family-authored records, receipts and tombstones, billing) is backed up;
   derived data that can be rebuilt need not be (runbook "Data classes → RPO/RTO").
2. Backups are encrypted before they touch disk; the decryption identity is held apart from the
   archives; the erasure journal is stored independently of the database.
3. Until managed point-in-time recovery is configured, take a backup daily off-box and keep at
   least 30 days (runbook).
4. `BACKUP_RETENTION_DAYS` states the real backup window so deletion receipts tell the truth
   (`docs/data-retention.md`).
5. **Every restore replays erasures** so deleted households are not resurrected.
6. A restore drill runs every quarter and after changes to `erasure.ts`, `restore.sh` or the
   MongoDB version, with a recorded result and time against RTO (objective O8).

## Enforced today

`scripts/ops/backup.sh`, `scripts/ops/restore.sh`, `scripts/ops/restore-drill.ts`,
`apps/api/src/erasure.ts`.

## Not yet in place

Managed PITR; scheduled (not manual) backups and drills with records (G-OPS-01); region-failure
decision tied to RTO (G-OPS-05).
