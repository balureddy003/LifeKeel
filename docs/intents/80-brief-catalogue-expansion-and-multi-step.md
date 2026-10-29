# Intent 80: More family events in the catalogue, with dated multi-step briefs

**Problem** — The factual catalogue (Intent 78) covers 33 dated events but leaves
out some of the most common and most shareable ones: renters (the catalogue is
mortgage-heavy), a lump sum arriving, "can we afford this?" planned spend, a
parent's care fees starting, illness with reduced hours, bereavement, and a bill
in one name. The solver also rejects a change date before today, so a family whose
hours were cut last week cannot use it, and it supports only one change plus one
later change, which cannot state parental pay correctly (full pay, a reduced
period, then a lower flat rate).

**Done looks like**
- New catalogue entries, each deterministic on household-entered figures:
  rent rise or tenancy ending (with deposit as a one-off payment), windfall or
  lump sum arriving, planned big spend (one-off or recurring cost), care fees
  starting, illness or recovery with reduced hours, bereavement (surviving adult;
  handover-style), and a bill or account in one name (handover-style).
- A brief may use a past change date for events already under way; the runway is
  always computed from today, and the facts show the entered date as entered.
- A brief may carry an ordered list of dated steps (income, spending or one-off
  change each), so a pregnancy brief can show several pay stages and a mortgage
  brief can show the new payment and a later "one income stops" step. The form
  adds a row per step, with a sensible maximum, and the result states the
  months after each step.
- Every new entry's fixed template text passes `advice-rule.test.ts`; "planned
  spend" shows runway before and after the household's own figures and never says
  whether to proceed. The scan covers catalogue titles, field labels and the
  generated sentence, not only the PRD text, with a test.
- Every money brief states what it does not cover (tax, benefits, investment
  returns, fee increases) and points to free guidance (for example MoneyHelper) and
  "a licensed professional". It never says a household "can afford" something.
- **Quick brief:** every entry has a version that asks for three numbers and a date,
  shows the first result, and then offers the optional fields. Drop-off per field
  is measured, not only completion.
- The catalogue is grouped by moment ("a baby is coming", "a job is changing",
  "a parent needs care", "a fix is ending"). The landing shows four doors; the rest
  are reachable from a search. Which door a family used is recorded.
- `planned_spend` and `care_fees_start` are **held** until a compliance reviewer
  has approved their wording; the other new entries may ship first.
- Regression tests cover each new entry's arithmetic, past dates, multi-step
  ordering and validation errors, plus the shared-page and confirmation journeys
  for at least one new money entry and one new handover entry.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; calculation and
  manual records only; sharing stays explicitly user-initiated.
- Regulated-advice check: care fees record the household's entered cost only, with
  nothing on funding eligibility, providers or benefits; windfall and rent briefs
  never suggest uses or products; no market rates or entitlements are inferred.
- Data/privacy limits: the Intent 78 rules apply unchanged; any new sensitive
  handover entry uses the encryption from Intent 79.

**Out of scope** — Separation and child-maintenance briefs (parked pending a
safeguarding review), statutory-pay or benefit estimation, bank or pension feeds,
and model-written narration of handover content.

**Becomes** — [docs/prd/227-brief-catalogue-expansion-and-engine-hardening.md](../prd/227-brief-catalogue-expansion-and-engine-hardening.md) (Part B)
