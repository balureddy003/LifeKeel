# Life stages and crisis-response: shared reference

Second shared reference alongside [000](000-market-landscape-and-positioning.md) —
that doc covers the competitive landscape; this one covers the financial
life-cycle and crisis-response research that PRD-104 through PRD-108 are
built against. Research current as of September 2026; re-verify before
using it to justify a build decision more than ~6 months out.

## The life-cycle framework wealth management already uses

Financial advisors split a client's life into five to six phases —
formative years, early career, mid-career, pre-retirement, retirement —
because the right financial *posture* (how much risk to carry, what to
protect, what to build) changes predictably with age and the balance of
human capital vs. financial capital, even though the events that interrupt
it don't. ([CFA Level III — Financial Stages of
Life](https://analystprep.com/study-notes/cfa-level-iii/financial-stages-of-life/),
[Modera Wealth Management — Financial Planning Through Life's
Stages](https://moderawealth.com/financial-planning-through-a-clients-life-stages/),
[SmartAsset — Understanding the Life-Cycle Approach for Your
Clients](https://smartasset.com/advisor-resources/financial-planning-life-cycle))

Agent Oak's own retirement-gap detector already implements one slice of
this correctly (the current-age-25 gate on `no_retirement_savings`,
verified live). The framework matters here because it's the organizing
structure PRD-104 and PRD-106 are checked against — not a new invention,
the industry-standard shape.

## Life events are the part a static, age-only model misses

Six age-based stages explain *posture*. They don't explain *crises* — job
loss, bereavement, divorce, a disability diagnosis, a recession, an aging
parent needing care — which land at any age and demand a specific,
sequenced response, not a generic insight. Every researched source treats
these as a distinct category from routine life-stage planning:

- **Job loss / redundancy.** File for unemployment immediately — delay is
  the single costliest mistake. Spending falls into three tiers: (1)
  rent/mortgage, utilities, food, insurance, (2) secured debt, (3)
  everything else — fund tier 1 first, always. Households with 6+ months
  of runway are 8x less likely to face foreclosure. ([Wells Fargo — How to
  prepare for job loss or income
  disruption](https://stories.wf.com/your-money/building-wealth/financial-planning-for-job-loss/),
  [Piere — Your Job Loss Playbook: 7 Days to Financial
  Stability](https://www.piere.com/your-job-loss-playbook-7-days-to-financial-stability-2/))
- **Death of a spouse.** A structured 3-month checklist, not a single
  appointment: 5+ certified death certificates, notify the employer (life
  insurance, pension survivor benefits) and every insurer, keep bills and
  premiums current while retitling joint accounts, avoid irreversible
  decisions in the acute window. ([U.S. Bank — A three-month financial
  checklist](https://www.usbank.com/financialiq/manage-your-household/life-events/losing-a-loved-one/when-your-spouse-has-passed-away-a-three-month-financial-checklist.html),
  [Prudential — Death of a spouse
  checklist](https://www.prudential.com/financial-education/death-of-spouse-checklist),
  [Principal — What to do when your spouse
  dies](https://www.principal.com/individuals/build-your-knowledge/financial-checklist-things-do-when-your-spouse-dies))
- **Divorce.** Gather 3 months of statements across every account before
  signing anything; open an individual account before any joint one is
  touched; update every beneficiary after the decree — pensions and life
  policies pass *outside* a will, so a stale beneficiary silently overrides
  new intentions, the most commonly missed step across every source
  reviewed. ([Broadview — 8-Point Financial
  Checklist](https://www.broadviewfcu.com/blogs/getting-divorced-use-this-8-point-financial-checklist/),
  [U.S. Bank — Financial Planning for a
  Divorce](https://www.usbank.com/wealth-management/financial-perspectives/financial-planning/financial-planning-for-divorce-dividing-money-after-split.html))
- **Disability / critical illness.** Critical illness pays one lump sum on
  diagnosis; income protection pays an ongoing percentage while unable to
  work — commonly confused, and most families need both. Target 60–70% of
  pre-event income replaced; most plans default to 3–6 months of cover.
  ([Western & Southern — Critical Illness vs. Disability Income
  Insurance](https://www.westernsouthern.com/personal-finance/critical-illness-vs-disability-income-insurance),
  [Guardian — Income Protection vs. Disability
  Insurance](https://www.guardianlife.com/disability-insurance/income-protection))
- **Recession / market crash.** The 3-month emergency-fund bar moves to
  6–12 months during a downturn — the one rule researched sources revise
  upward, not down. Low debt-to-income going in is the strongest predictor
  of resilience across every downturn since 1950; the most-repeated
  warning is against panic-selling a falling portfolio. ([Carson Wealth —
  Crisis Management Financial
  Planning](https://www.carsonwealth.com/insights/blog/crisis-management-financial-planning-preparing-for-unexpected-events/),
  [Boyce Wealth — Secure Family Finances in a
  Recession](https://www.boycewealth.com/thought-leadership/strategies-to-secure-family-finances-during-recession))
- **Aging-parent care (sandwich generation).** ~47% of adults in their
  40s–50s are already supporting both a child and a parent financially.
  Every source treats "have the money conversation before a care need
  exists" as the single highest-leverage action — and "too late" as the
  default outcome without it. Fund your own retirement first: there's no
  loan for that, unlike university. ([Discover — Budgeting tips for the
  sandwich
  generation](https://www.discover.com/online-banking/banking-topics/budgeting-tips-for-the-sandwich-generation/),
  [Kiplinger — Survival Guide for the Sandwich
  Generation](https://www.kiplinger.com/retirement/retirement-planning/expert-survival-guide-for-the-sandwich-generation))
- **UK-specific guidance shape.** MoneyHelper (the UK's government-backed
  Money and Pensions Service — relevant since Agent Oak's schema is
  GBP-denominated) organizes its own guidance around the identical pattern:
  routine life-stage help (starting a pension, then investing it) plus a
  named list of life events that trigger dedicated guidance — buying or
  renting a home, separation and divorce, job loss, bereavement, having a
  baby. Independent confirmation this is the right organizing shape for a
  UK family product, not just a US pattern. ([MoneyHelper — Get help with
  financial
  decisions](https://www.moneyhelper.org.uk/en/getting-help-and-advice/financial-advisers/guidance-targeted-support-and-advice-explained))

## Household-shared vs. per-person: the personalization gap

Every mainstream family-finance app researched aggregates to a **shared
household view**: Monarch Money supports Admin/Member/Professional roles
with each person getting their own login, but the underlying data model is
one household, one set of numbers everyone sees — not distinct reasoning
per person. Copilot's sharing model is even flatter: a second person gets
full account control rather than a scoped role. Origin's forecasting
explicitly frames a partner's income/savings/goals as inputs *into one
household plan*, not a separately-reasoned identity. ([Monarch — For
Couples and
Households](https://help.monarch.com/hc/en-us/articles/20926382202004-Monarch-for-Couples-and-Households),
[x1wealth — Copilot vs Monarch Money
(2026)](https://x1wealth.com/compare/copilot-vs-monarch), [Origin —
Planning Your Future with
Origin](https://useorigin.com/resources/blog/planning-your-future-with-origin-a-guide-to-our-forecasting-tool))

Multi-family offices solve a different, harder problem: personalizing
around each individual family member's own situation while still rolling
up to one consolidated household picture — different logins and access by
person, individualized planning, a genuinely composed (not blended)
household view. ([Cresset — What Is a Multi-Family
Office?](https://cressetcapital.com/family-office/multi-family-office/),
[Creative Planning — What Is a Multi-Family
Office?](https://creativeplanning.com/insights/family-office/multi-family-office/))

**This is the gap PRD-104 targets.** No AI money app researched does
per-person reasoning within a shared household today — it's a genuine
differentiation opportunity, not a catch-up feature, consistent with
000's finding that "digital twin" framing itself is uncontested territory
in the consumer market.

## What this means for the PRD set that follows

- **PRD-104** closes the structural gap above: the Family Twin already
  models multiple people by name/role (`family-group.ts`); the financial
  profile doesn't extend that to income/protection per person yet.
- **PRD-105** and **PRD-106** are correctness/coverage fixes the life-cycle
  research surfaced directly: gaps found by driving real household
  scenarios through the live detector engine, not hypothetical.
- **PRD-107** is the reliability precondition for all of the above —
  insights that don't retract erode trust in exactly the moment a crisis
  playbook needs to be believed.
- **PRD-108** is the crisis-playbook research turned into a shippable
  feature — and notably, ARCHITECTURE.md's roadmap already names this
  direction independently ("extend 'prepare' beyond insights, e.g.
  event-response checklists") before this research existed. That
  convergence is treated as confirmation, not coincidence.
