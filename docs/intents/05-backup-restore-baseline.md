# Intent: backup/restore baseline + first restore drill

**Problem** — no backup scripts, PITR config, DR documentation, restore
runbook, or recovery evidence exists anywhere in the repo. The product
promises family/vault continuity on unproven infrastructure; a restore drill
without an erasure-replay check tests availability but not privacy.

**Done looks like**
- Per-data-class RPO/RTO recorded in the data catalogue (from the erasure
  intent); authority data gets PITR or scheduled encrypted exports; derived
  state (feed, rollups, LLM cache) explicitly excluded from backup scope.
- A `runbooks.yaml` restore runbook with owner, steps, and verification.
- One executed restore into a scratch environment, including the
  erasure-replay/crypto-shredding check chosen in the erasure intent, with
  written evidence — first entry in a drill cadence.

**Constraints**
- Trust tier touched: none; approval gate: operator runbook.
- Regulated-advice check: none.
- Data/privacy limits: restores must re-apply erasure state before serving;
  backup retention disclosed on erasure receipts.

**Out of scope** — multi-region recovery (P2, decided by measured RTO after
this drill); backup for rebuildable derived data.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md
