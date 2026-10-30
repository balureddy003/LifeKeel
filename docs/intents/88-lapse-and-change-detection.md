# Intent 88: A stopped payment, noticed

**Problem** — A protection policy can end because a premium stops, often through a
cancelled direct debit or an expired card, and the household finds out at claim time. UK
Ombudsman decisions show insurers declining claims where cover had ended for non-payment,
including a case where a direct debit was cancelled by accident
([Financial Ombudsman decisions](https://www.financial-ombudsman.org.uk/decision/DRN-6093597.pdf)).
Some decisions turn on whether required written notice of cancellation was given. A
grace period of about 30 days is commonly cited; whether it is a rule is **not confirmed**
here (a broker guide calls it a protection, not a regulation). Check ICOBS and PRIN 2A
before any copy mentions grace periods. Seeing last year's renewal beside this year's, or
a payment that stopped, needs continuous data.

**Done looks like**
- Policy facts keep a history: premium, renewal date and the payment pattern the
  household has told LifeKeel about or LifeKeel has read from a source.
- When an expected renewal or payment has no record by its date, an in-app signal says
  "no payment on file since <date>; check with your provider that cover is in force".
  It does not say the policy has lapsed, because LifeKeel cannot know.
- Price creep: last premium versus this premium is shown as figures and a date (extends
  the existing premium-increase rule).
- Signals can be dismissed with "I have checked", and are not re-raised for the same
  period.
- No outbound message. The signal appears in the app, in the digest and in the
  household's existing share, per PRD-139 caps.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; informational.
- Regulated-advice check: low risk. Never "reinstate your policy", never a provider or
  replacement; point to the household's own provider. Passes `advice-rule.test.ts`;
  detector evals in `detector-evals/` for missed, late and changed-premium cases.
- Data/privacy limits: payment data, if any, is a read-only extracted fact with its
  source; no bank feed is required (Stage 3 is separate); rule 3 applies.
- Friction: depth, not front door (PRD-230 item 9). A household that enters renewal dates
  by hand gets the same signal.

**Out of scope** — Contacting the provider, reinstating cover, payment initiation (a
second regulated activity), and any claim-outcome statement.

**Becomes** — [PRD-233](../prd/233-lapse-and-change-detection.md)
