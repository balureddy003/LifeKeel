# PRD-104: Per-member financial identity in the Family Twin

## Problem

`FinancialProfileSchema.household` in
[family-financial-profile.ts](../../apps/api/src/routes/family-financial-profile.ts)
models the entire household as one `employment_status` enum and one
`monthly_salary_minor` number. A two-earner family with genuinely
different situations — one retired and one still working, one salaried
and one self-employed with irregular income — has no way to enter both;
they have to pick a single label for the household.

Verified live, not theoretical: the identical real gap (£6,000/month
salary, £0 income protection, age 45) was submitted twice, changing only
`employment_status`. `employed` correctly fired `no_income_protection`
(estimated impact £36k–£144k). `retired` produced zero insights for the
exact same money — because `hasIncomeToProtect` in the route only checks
the single household-level status. The family roster
(`FamilyMemberDoc` in [family-group.ts](../../apps/api/src/routes/family-group.ts))
already models multiple people by name and role; their finances don't
exist anywhere.

## Market bar

See [007](007-life-stage-and-crisis-response-research.md#household-shared-vs-per-person-the-personalization-gap).
Monarch, Copilot, and Origin all aggregate to one shared household
picture — none reasons about each family member's situation separately.
Multi-family offices do exactly that, at a different price point. No
mainstream consumer product does per-person reasoning inside a shared
household view today; this is the differentiation opportunity 000's
"digital twin" framing already flags as uncontested territory, extended
from the Family Twin's people domain into its financial domain.

## Who it's for

Any household that isn't a single earner with one clean employment
status — which, per this repo's own research, includes a retired partner
still living with a working spouse, a salaried-and-self-employed couple,
and (looking ahead one stage) a working teenager or young-adult child
whose own first-job situation is currently invisible to the model
entirely.

## What "done" looks like

Each entry in the family roster can optionally carry its own financial
identity: `employment_status`, `monthly_salary_minor`,
`income_protection_monthly_minor`. The existing household-level fields
become the computed roll-up (sum of salaries; `employed` true if *any*
member is employed or self-employed) rather than a single manually-entered
figure — `no_income_protection` and future per-member rules evaluate each
earner independently, so a retired-plus-working household correctly
surfaces the working member's real gap. A family with only one adult on
the roster behaves exactly as today (no regression, no extra data-entry
burden for the common case).

## Trust tier

**Tier 0 — Observe/Understand/Predict.** Pure data-model and detector
extension. No new external side effect, no new Act surface.

## Scope

Follows the same 3-step convention CLAUDE.md documents for a new family
signal, applied to an existing one:

1. Extend `family-financial-profile.ts`: add an optional `members[]` array
   to the household object (`member_id` referencing the roster,
   `employment_status`, `monthly_salary_minor`,
   `income_protection_monthly_minor`), keep the flat fields as a
   backward-compatible default for single-adult households.
2. Update the `family_protection_gap` detector's data-mapping step (route
   code, not the YAML) so `employed` and `monthly_salary_minor` are
   derived per-member where `members[]` is populated, and the
   `no_income_protection` rule evaluates once per earner instead of once
   per household. `retirement-gap.yaml` and `emergency-fund-adequacy.yaml`
   stay household-level for this PRD — see "Out of scope."
3. Extend the financial-profile wizard: an optional "add a second earner"
   step, pre-populated from the family roster's existing names, only shown
   when the roster has more than one adult.
4. Extend the assistant's grounding context (`assistant.ts`, currently
   reads `h.employment_status`/`h.monthly_salary_minor` as flat fields) to
   read per-member data when present, so PRD-101's live reasoning doesn't
   silently regress to the single-earner view.

Out of scope: per-member retirement/pension tracking (a household usually
shares one retirement *goal* even with two earners — splitting that is a
bigger, separately-justified change) and per-member emergency-fund
tracking (the fund itself is typically shared). This PRD is scoped to
income and income-protection, where the KEEL-029 evidence is concrete.

## Success metrics

- **Second-earner completion rate** among households with 2+ adults on
  the family roster — the feature is worthless if the optional step is
  never used.
- **`no_income_protection` fire-rate change** among multi-adult households
  pre/post-launch — the expected, desired outcome is an *increase*, since
  the whole point is surfacing gaps the single-status model was hiding.
- **Zero regression** in `no_income_protection` fire-rate for
  single-adult households (the common case must behave identically).

## Acceptance criteria

- A household with `employment_status: 'retired'` and a second roster
  member with `employment_status: 'employed', monthly_salary_minor:
  600000, income_protection_monthly_minor: 0` fires
  `no_income_protection` — the exact scenario that failed silently before
  this PRD.
- A household with no `members[]` entries behaves byte-for-byte as today
  (regression test against the existing 24-scenario engine test suite).
- The financial-profile wizard's second-earner step never appears for a
  single-adult roster.
- The assistant's grounded answers reference per-member income correctly
  when asked ("does my husband have income protection?"), not just the
  household total.
