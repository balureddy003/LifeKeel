# Intent 39: Subscription packaging, pricing frame, and paywall moments

**Problem** — The 2026-10-24 expert-panel review (positioning/subscription
role-play in `qa-critic-review-2026-10-24.md`) argues conversion comes from
packaging, not louder marketing: gate on demonstrated value, make the free
tier genuinely useful, and place the paywall at the moment the user has
felt value. Several of its asks are business decisions, not engineering —
but two have real product surface and currently have no owner.

**Done looks like**
- **Annual pricing frame.** Keel Plus offers an annual plan presented as a
  lower monthly equivalent ("less than £X/mo billed yearly") alongside
  monthly — matching how families budget household bills. A PRD-006-era
  billing decision that needs an owner decision on the annual price point,
  then a Stripe price + checkout/plan display change.
- **Paywall moments, per PRD-206's rule.** The panel's endorsed moment —
  "after uploading a document and seeing the runway: 'Keel Plus reads the
  rest and keeps {partner} in the loop'" — fits the existing rule (upgrade
  prompts only where parsing closes a data gap, never from a risk alarm).
  Concretely: the post-upload state from intent 27 carries one honest Plus
  mention; the invite/status surface from intent 23 may reference "keeps
  the family updated" as a Plus benefit.
- **Free-tier generosity is an explicit decision.** "Don't starve free"
  (the Life360 lesson the panel cites) vs the report's "free basic date
  extraction" suggestion are in tension — the founder picks the free/Plus
  line deliberately and it is recorded, not drifted into. This intent
  proposes: free = everything manual + stored-document confirmation +
  honest runway; Plus = removes typing (extraction, inbox summaries) and
  keeps the family informed (digests, pack).
- Upgrade copy passes `advice-rule.test.ts`; "peace of mind" framing only,
  never product selling.

**Constraints**
- Trust tier: 0 — pricing display and prompt placement; the checkout itself
  is the existing PRD-006 Stripe path.
- Regulated-advice check: marketing copy must never imply advice or product
  recommendation — the panel's own "never: 'we sell insurance'" line.
- Data/privacy: no paywall telemetry on family content; conversion events
  stay anonymous enums (growth-events allow-list).

**Out of scope** — the free-extraction decision's engineering (if the
founder picks it, that's a pricing flip on the PRD-143 pipeline gate, not
this intent), the always-current executor-shared pack (open fork vs
PRD-220's no-URL design — needs its own trust-tier decision), new Plus
features.

**Becomes** — PRD in docs/prd/ amending PRD-006/PRD-206; founder decisions
needed on annual price and the free/Plus line.
