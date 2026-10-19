# Intent: architecture-claims fitness tests

**Problem** — ARCHITECTURE.md's "Implemented" claims have already drifted from
code in ~6 places (dead OTel init, CSP-blocked WebLLM, `approved_by` missing
from receipts, stale register rows). Nothing prevents the next drift; the
3,000-line document is self-assessed. Critical review F9 + remediation plan
Stage 0.

**Done looks like**
- `architecture-claims.test.ts` fails CI when: a tenant-tagged collection is
  written but absent from `DELETABLE_COLLECTIONS` or an explicit retain list;
  `withSpan`/`getTracer` have zero production call sites; `ActionReceipt`
  lacks `approved_by`/`approved_via`; `NEVER_AUTONOMOUS` and marketing
  auto-publish both permit the same action class.
- A web vitest parses `firebase.json` CSP and asserts connect-src/script-src
  permit every feature enabled by default.
- §16 register rows corrected (key versioning exists; erasure scope is wider
  than AI-derived).
- Quarterly claim-verification checklist added to `docs/sdlc/` with a named owner.

**Constraints**
- Trust tier touched: none (test/infrastructure only); approval gate: CI.
- Regulated-advice check: no user-visible output.
- Data/privacy limits: tests must not require production data.

**Out of scope** — fixing the underlying gaps (separate intents); ADR process
beyond the checklist.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md
