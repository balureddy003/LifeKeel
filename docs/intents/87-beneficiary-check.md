# Intent 87: Nominations that no longer match the family

**Problem** — Pension and death-in-service nominations are often out of date after
family changes. UK surveys (different samples and years, not directly comparable): 72%
had not completed an expression of wish
([Canada Life 2022, via International Adviser](https://international-adviser.com/72-of-brits-never-completed-a-pension-will));
only 38% said forms were current across all pensions
([Hargreaves Lansdown, via Financial Planning Today](https://financialplanningtoday.co.uk/news/warning-that-3-in-5-pension-wills-out-of-date));
about 3% believed their nominee might still be an ex-partner
([Hodsons summary](https://hodsonsfinancialservices.co.uk/?p=1140)).
Forms are usually not binding because the scheme is held in a discretionary trust and the
trustees decide, though schemes differ, and some must pay the named person
([Foot Anstey](https://www.footanstey.com/?p=7818)).

**Done looks like**
- The household records who is nominated on each pension and policy (entered, or
  extracted and confirmed) and the date of the nomination if known.
- A flag appears when a recorded nomination and the current family differ in a **factual**
  way: a named person marked as an ex-partner, a child added to the family after the
  nomination date, or no nomination on file. The flag states what differs and the date
  of the record.
- Each flag points to the provider's own form or page where one is on file. LifeKeel does
  not say who should be named, and does not state how a scheme will pay out; it says
  "trustees or the scheme decide, check the scheme's rules".
- A flag disappears when the household records a newer nomination date, and is never
  re-raised without new information.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; flag and link only. LifeKeel
  never completes, submits or changes a nomination.
- Regulated-advice check: **medium risk.** "Differs from your record" is informational;
  "change it to X", "name your partner", or any statement about tax or inheritance
  consequences is advice and is excluded. Copy passes `advice-rule.test.ts`; add a
  detector eval with ex-partner, new-child and no-nomination cases.
- Data/privacy limits: relationships and beneficiary names are sensitive; children's data
  follows the children's-data posture; an ex-partner flag must be visible only to the
  person whose nomination it is (no cross-adult disclosure without that adult's
  confirmation, Intent 82).

**Out of scope** — Wills, trusts, inheritance tax, pension transfers, and choosing
beneficiaries.

**Becomes** — [PRD-234](../prd/234-beneficiary-check.md)
