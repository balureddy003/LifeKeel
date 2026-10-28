# Market landscape and positioning

Shared reference for every PRD in this directory — the competitive bar
each feature is written against, so individual PRDs can cite this instead
of re-deriving it. Research current as of September 2026; re-verify before
using it to justify a build decision more than ~6 months out.

## The three categories LifeKeel sits between

No single competitor combines all three. That gap is the product.

**1. AI money-management apps** (Monarch Money, Copilot Money, Origin,
Empower, Cleo, YNAB, Rocket Money). Strong at aggregation, budgeting, and
increasingly AI-driven insight — Origin's AI Advisor reportedly scores
98.3% on the CFP® exam and runs a multi-agent architecture with
deterministic math across budgeting, investing, net worth, taxes, and
estate planning. Monarch differentiates on shared/couples accounts. None
of these are built around *protection* or *emergency readiness* as a
first-class concept — they're spending/net-worth tools that treat
insurance as a line item, if at all. ([Copilot vs Monarch](https://useorigin.com/resources/blog/copilot-vs-monarch-which-is-better-for-your-financial-life), [Origin AI Advisor](https://useorigin.com/resources/blog/how-does-origins-ai-advisor-compare-to-monarch-and-other-ai-finance-apps), [Best AI financial planning apps 2026](https://www.getitplanned.com/blog/best-ai-financial-planning-apps-in-2026))

**2. Family life-admin / digital-vault platforms** (Trustworthy — "The
Family Operating System®", Everplans, Cake). Strong at document storage,
family-wide access (not just single-user), and emergency-contact/estate
organization. Trustworthy in particular already frames itself around
family-wide document and policy storage — the closest existing competitor
to LifeKeel's "Family Twin" framing — but stops at *storage and
organization*; it doesn't run detectors over the data or reason about
whether coverage is adequate. Everplans is comparatively single-user and
skews toward end-of-life planning specifically. ([Trustworthy vs
Everplans](https://www.trustworthy.com/blog/trustworthy-vs-everplans/))

**3. Insurance-gap and quote tools** (Policygenius, Ladder). Strong,
narrow point solutions: calculate a DIME-method coverage number, compare
quotes, buy a policy. A coverage gap, in their own framing, is simply "you
don't have enough life insurance coverage" against a calculator output —
useful but one-shot, not continuously monitored against a family's actual
changing situation (a new mortgage, a new child, income change).
([Life insurance coverage gap](https://www.policygenius.com/life-insurance/what-is-a-life-insurance-coverage-gap/), [Ladder calculator](https://www.ladderlife.com/calculator))

## What "world-class" means for each PRD in this set

- **Continuous, not one-shot.** Policygenius-style calculators run once;
  LifeKeel's detectors should re-evaluate whenever the underlying data
  changes (a document upload, a profile edit), the way none of the point
  tools above do.
- **Whole-family, not single-user.** Match Trustworthy's family-wide model
  (not Everplans' single-user-plus-deputies model) — every domain (Family
  Twin, Intelligence, Action Network) should be scoped to the household,
  not one login.
- **Reasoning grounded in the family's real data, not templated advice.**
  Match the AI-money-app category's bar (Origin's deterministic-math
  multi-agent approach is the reference point) rather than LifeKeel's
  current hardcoded response map — see PRD-101.
- **"Prepare, not send" as the hard boundary for Tier 1, matching 2026
  fintech HITL consensus.** The emerging standard pattern: the agent
  drafts, plans, and proposes; a human owns anything that sends, pays, or
  commits — "never auto-send." LifeKeel's roadmap already independently
  arrived at this shape (see CLAUDE.md's trust tiers); external practice
  confirms it's the right bar, not overcaution. ([Human-in-the-loop AI
  agents 2026](https://www.buildmvpfast.com/blog/human-in-the-loop-ai-agents-implementation-patterns-2026), [HITL governance](https://www.arthur.ai/column/human-in-the-loop-governance-for-ai-agents))
- **"Digital twin" and "emergency mode" are genuinely differentiated
  framing, not table stakes to catch up on.** Searches for a consumer
  "family digital twin" or scenario-rehearsal product turned up nothing —
  "digital twin" is presently enterprise-finance jargon (Capgemini, TCS)
  for corporate risk modeling, not a consumer category. LifeKeel's
  Events/"What If?" scenario simulator (see PRD-005) is closer to a novel
  mechanic than a catch-up feature — worth protecting and investing in
  deliberately, not treating as a generic "insights" screen.

## October 2026 UK market update & the brief platform pivot (PRD-222–226)

The market is crowded with storage and advice, and empty of a **shared, computed
brief for a real household problem**. That is the opening for a platform:

- **Document and legacy vaults (the crowded layer):** SafeKeep, Biscuit Tin,
  Capsafa (free, launched September 2026, Executor Pack always free),
  SuccessionKeeper (£4/month or £39/year, check-in system), Lyfeguard (free +
  Pro £4.99 with open-finance connections), Safe4, and others. They store files
  or a map of where things are, name a contact, and charge roughly £3–£7 a month
  or stay free. None of them lead with *"how many months if one income stops,
  and has the other adult opened it?"*
- **Protection distribution:** The FCA's Pure Protection Market Study final
  report (21 September 2026) found that 58% of adults hold no life,
  critical-illness, or income-protection product, and 59% of that group have
  never considered it. Competition works for people who already hold cover. The
  gap is awareness and prompts, not a shortage of products. The FCA is not
  adding broad new rules; it is pushing industry-led awareness and a possible
  TechSprint in Q3 2027.
- **Employer and benefits platforms:** Alltoogether places cover and gives
  employees a portal. Bippit sells coaching, mortgage advice, and will-writing
  to employers. Perkbox, Reward Gateway and others sell discounts and admin.
  They are paid by the employer or on placement. They do not show a household
  runway the second adult has seen, and they cannot refuse to sell without
  breaking their model.
- **Data feeds that will arrive later:** Moneyhub is already powering household
  open-banking views (Know Your Dosh tracks £200m+). The public MoneyHelper
  pensions dashboard is expected in the 2027/28 financial year; private
  dashboards follow only after that.
- **The gap LifeKeel takes (Stages 1–4, PRD-222–226):** A household can store a
  PDF, name a contact, or be sold a policy. It cannot, in one evening, answer a
  specific upcoming problem with a number both adults have seen (`opened_at`),
  and leave without a product recommendation. LifeKeel is not a vault competing
  with Capsafa or SafeKeep on storage price, not a benefits broker or
  will-writer, not a comparison site or model that invents figures, and not a
  private pensions dashboard before the rules allow it. It is the household
  graph that keeps a growing set of computed briefs true over time, and that
  other tools can read only when the family allows it.


## Reading list

- [Copilot vs Monarch: Which Is Better for Your Financial Life?](https://useorigin.com/resources/blog/copilot-vs-monarch-which-is-better-for-your-financial-life)
- [How Does Origin's AI Advisor Compare to Monarch and Other AI Finance Apps?](https://useorigin.com/resources/blog/how-does-origins-ai-advisor-compare-to-monarch-and-other-ai-finance-apps)
- [Best AI Financial Advisor and Planning Apps in 2026](https://www.getitplanned.com/blog/best-ai-financial-planning-apps-in-2026)
- [Trustworthy vs. Everplans Digital Vault: How They Compare](https://www.trustworthy.com/blog/trustworthy-vs-everplans/)
- [What Is a Life Insurance Coverage Gap? — Policygenius](https://www.policygenius.com/life-insurance/what-is-a-life-insurance-coverage-gap/)
- [Life insurance calculator — Ladder](https://www.ladderlife.com/calculator)
- [Human-in-the-Loop AI Agents: Implementation Patterns (2026)](https://www.buildmvpfast.com/blog/human-in-the-loop-ai-agents-implementation-patterns-2026)
- [Human-in-the-Loop Governance for AI Agents — Arthur](https://www.arthur.ai/column/human-in-the-loop-governance-for-ai-agents)
- [Embracing Digital Twins to Reimagine Finance Functions — TCS](https://www.tcs.com/content/tcs/global/en/what-we-do/industries/high-tech/article/digital-twins-finance-functions)
