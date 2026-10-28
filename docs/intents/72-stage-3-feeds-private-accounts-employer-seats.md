# Intent 72: Stage 3 — Feeds into the same number, hidden accounts, and employer seats

**Problem** — Currently, `external_accounts` (from read-only Open Banking sync, PRD-133) sits in a separate table and never updates the savings figure used by the runway solver; every synced or manual account is visible to all adults in the tenant with no way for one adult to keep an account private; and employer distribution (PRD-207) has no concrete seat-grant billing layer that guarantees the employer never sees household figures and never pays per policy.

**Done looks like**
- **Balances feed the same number:** read-only account balances in `external_accounts` (and, when legally usable after the 2027/28 public MoneyHelper dashboard, read-only pension pots) write into or link directly to the profile fields the deterministic solver already reads (`emergency_savings_minor`, `pension_balance_minor`), bumping the brief's `data_version` and marking affected briefs stale.
- **One adult can hide an account:** `external_accounts` and `family_assets` gain `owner_user_id` and `visibility: 'shared' | 'private'`. A private account is excluded from shared household briefs and other members' reads.
- **No pension consolidation journey:** a found or updated pension pot updates the retirement component only; it never triggers a transfer, consolidation, or provider recommendation flow (`CLAUDE.md` Rule 2).
- **Employer seat:** a flat per-seat fee lets staff run a brief (`employer_seat_grants`), with a hard architectural wall: the employer never receives any brief payload, figures, or individual usage status, and there is zero fee or commission per policy.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0** (read-only balance sync, member-scoped visibility filter, billing entitlement).
- Regulated-advice check: no pension consolidation, no product steering, no employer broker commission, no private pensions dashboard before FCA rules permit it.
- Data/privacy limits: server-side redaction of `visibility: 'private'` accounts before brief projection or household serialization; employer seats expose zero tenant data to the employer.

**Out of scope** — Payment initiation (PISP), pension transfer/consolidation journeys, or operating a regulated pensions dashboard service ahead of FCA authorization rules.

**Becomes** — [docs/prd/224-stage-3-feeds-private-accounts-employer-seats.md](../prd/224-stage-3-feeds-private-accounts-employer-seats.md)
