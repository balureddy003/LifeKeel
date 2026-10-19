# Intent: erasure completeness + backup↔erasure reconciliation (extends PRD-146)

**Problem** — `DELETABLE_COLLECTIONS` (26) misses ~30+ tenant-tagged
collections including family-authored `family_assets`,
`family_cashflow_entries`, `legacy_*`, `family_scenarios`, `member_nudges`,
`external_accounts`, plus all AI-derived artifacts (`llm_cache`, `llm_spans`,
`llm_guard_events`, `llm_usage`, scorer/calibration state). And restoring an
old backup can reintroduce data a user was told was deleted.
Evidence: `routes/account.ts:43-69`.

**Done looks like**
- Data-class catalogue: every collection → owner, tenant key, sensitivity,
  retention, backup tier, delete-vs-retain decision (feeds the later DPIA work).
- Deletion covers the catalogue; the Stage-0 fitness test fails CI on any
  uncatalogued tenant-tagged collection.
- A recorded decision: crypto-shredding (per-tenant DEKs for vault/connector
  credentials) vs post-restore tombstone replay; the chosen mechanism is
  exercised in the restore drill (backup-restore intent).
- Erasure receipt honestly states backup-retention windows until data is
  shreddable (PRD-146 requirement).

**Constraints**
- Trust tier touched: 0–2 (erasure is a user- or operator-initiated effect;
  keep the human gate).
- Regulated-advice check: none.
- Data/privacy limits: this IS the privacy mechanism — deletion must be
  verifiable, receipted, and complete across derived artifacts.

**Out of scope** — per-tenant DEK implementation mechanics beyond the
decision (Stage B4); provider-side retention reconciliation (needs the task
registry's processor terms).

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md (or PRD-146 amendment)
