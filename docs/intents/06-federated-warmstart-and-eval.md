# Intent: quarantine federated warm-start + per-tenant eval

**Problem** — live code violates CLAUDE.md rule 3 in two places:
`FeatureHashScorer`/`TenantLevelScorer` warm-start from
`federated_global_models.latest` unconditionally (no consent/provenance gate),
and the weekly `feature_hash_eval` job pools approved/dismissed insights
across all tenants to train a temporary scorer. Docs admit the gap; code
doesn't enforce it.
Evidence: `feature-hash-scorer.ts:236-304`, `tenant-level-scorer.ts:232-504`,
`jobs/feature-hash-eval.ts:67-99,191-193`.

**Done looks like**
- Any existing `federated_global_models` artifacts deleted or quarantined;
  the warm-start read gated behind an explicit governed setting (default off,
  re-enable only via the opt-in/DPIA path in §8.8).
- `feature_hash_eval` rewritten per-tenant or on synthetic/redacted fixtures;
  stale trading-vertical fields removed.
- A test asserting scorer init does not read cross-tenant artifacts by default.

**Constraints**
- Trust tier touched: 0; approval gate: none new.
- Regulated-advice check: none.
- Data/privacy limits: rule-3 compliance — cross-tenant learning needs
  explicit opt-in, privacy review, minimum cohorts, and disclosure before
  any reactivation.

**Out of scope** — redesigning per-tenant scorers; federated-learning
reactivation (a separate governed decision, not this fix).

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md
