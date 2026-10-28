# Intent 76: Hard free-tier spend cap and zero-model-call first brief

**Problem** — In `apps/api/src/spend-ledger.ts` (`checkPlanSpendBudget`, line 186), the per-tenant monthly spend cap currently blocks only `budget_class: 'batch'` tasks (`if (spent < limit || policy?.budget_class !== 'batch') return { allowed: true }`). Free-tier users can therefore trigger unbounded hosted LLM or document extraction costs via `interactive` tasks before ever paying.

**Done looks like**
- **First brief uses zero model calls:** the entire Stage 1 brief flow (problem selection, input capture, deterministic solver, share link creation, and second-adult `opened_at` view) makes zero calls to `taskLlm`, `taskDecide`, `taskVision`, or OCR extraction, enforced by an integration test.
- **Hard free-tier spend cap across all budget classes:** `checkPlanSpendBudget` in `apps/api/src/spend-ledger.ts` enforces the monthly per-tenant cap (`DEFAULT_PLAN_BUDGET_USD.free`) as a hard stop for **both** `batch` and `interactive` tasks when `plan === 'free'`, returning `allowed: false` and a clear deterministic fallback/upgrade message instead of calling a hosted processor.
- **Document extraction sits behind the same budget:** any OCR / vision / extraction task records its cost into the unified spend ledger and checks `checkPlanSpendBudget` before execution.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0** (budget guard in the AI task gateway).
- Regulated-advice check: deterministic fallback copy when a free tenant hits the AI cap remains purely informational.
- Data/privacy limits: strengthens `CLAUDE.md` Rule 3 by preventing unnecessary hosted processor calls on the free tier.

**Out of scope** — Changing paid-tier (`plus`/`family`) interactive grace behavior where a paid household has active subscription headroom.

**Becomes** — [docs/prd/226-brief-scale-and-cost-architecture.md](../prd/226-brief-scale-and-cost-architecture.md)
