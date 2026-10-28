# Intent 75: Brief hot path and change-driven invalidation (no full sweeps)

**Problem** — Today, computing household readiness or scenarios loads the full financial profile, runs up to 9 YAML detectors, or relies on fixed daily cron sweeps (`stale-profile-evaluation.ts`, `scenario-watchlist.ts`) that scan across tenants even when nothing changed. As households grow, sweeping every tenant wastes compute and Mongo reads, while the brief only needs to be fresh when its specific inputs change.

**Done looks like**
- **Brief as the hot path:** a brief / problem pack is a fixed, code-driven sequence (never an open agent loop): load only the fields it needs (projected via Mongo field projection) → call the deterministic solver (`calculate.ts`) once → render the deterministic template sentence → store the result on `household_briefs` with `solver_version`, `data_version`, and `stale: false` → return the share link. Zero full-profile detector sweep and zero LLM calls on the brief route.
- **Two governed AI tasks only for the brief platform:**
  1. `brief.narrate` (`authority: language_only`, hosted or local, short output): optional separate step that rephrases the fixed template, enforced by a **server-side numeral-presence output guard** in `packages/platform/src/llm-guards.ts` (rejecting and falling back to the template if any output numeral is absent from the solver payload) and cached by `solver_version + data_version`.
  2. `document.extract_fields` (`authority: candidate_for_review`, local preferred via `structured-llm.ts`): extracts candidate policy fields (`provider`, `coverage_amount`, `deferred_period`, `renewal_date`, `premium`, `policy_number`) into `extraction_candidates`; a human must confirm/apply them before they affect a brief.
- **Change-driven invalidation:** any write to the inputs a brief depends on (`family_financial_profile`, linked `external_accounts`, or `family_cashflow_entries`) increments `data_version` and marks only the affected tenant's brief(s) `stale: true` (extending Intent 67's derivation-closure invalidation).
- **Read/share behavior:** reading a fresh brief (`stale: false` and matching `solver_version`) returns the stored solver result directly with zero recomputation; reading a `stale: true` brief recomputes once from the narrow input projection, updates the stored result, and clears `stale`.
- **Fixed sweeps demoted:** `stale-profile-evaluation` and `scenario-watchlist` no longer scan unchanged tenants; background jobs process only dirty/flagged records or dated boundary crossings (e.g. a renewal date or step horizon reached today).

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0** (deterministic computation and caching).
- Regulated-advice check: identical deterministic solver output; every numeral on the shared brief page is asserted against the cached solver payload (Intent 65).
- Data/privacy limits: tenant-scoped Mongo collections (`getTenantCollection`) preserved end-to-end.

**Out of scope** — Introducing a separate caching cluster, a message bus, or a microservice split.

**Becomes** — [docs/prd/226-brief-scale-and-cost-architecture.md](../prd/226-brief-scale-and-cost-architecture.md)
