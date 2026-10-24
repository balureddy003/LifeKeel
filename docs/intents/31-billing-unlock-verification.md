# Intent 31: Plus checkout → unlock verification (test gap)

**Problem** — The critic review could launch the Stripe sandbox checkout but
never verified the full loop: payment completion → webhook → Plus flag →
feature unlock (e.g. document extraction). The revenue path is currently
unproven end-to-end — a gap in verification, possibly (not yet known) in the
product.

**Done looks like**
- A scripted or e2e path exercises sandbox checkout → webhook handling →
  `plus` entitlement → a gated feature unlocking, run locally per
  docs/local-testing.md and/or in CI where secrets permit.
- Each hop's failure mode is observable (webhook signature failure,
  entitlement write failure, UI gate not reading the flag) — a broken link
  surfaces as a test failure, not a silent "checkout worked but nothing
  unlocked".
- Result documented: either "verified working" with evidence, or a filed
  defect list.

**Constraints**
- Trust tier: n/a — test/ops; Stripe stays in sandbox, no live payments.
- Regulated-advice check: n/a.
- Data/privacy: test tenants only; no real card or personal data.

**Out of scope** — pricing changes, PRD-006's production cutover decision,
new billing features.

**Becomes** — verification task + fast-path fixes for any defects found;
not a PRD unless a real product gap surfaces.
