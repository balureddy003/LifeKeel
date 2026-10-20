# LifeKeel: market analysis, positioning, strategy and vision, 2026–2029

Research date: 20 October 2026.

**Status: recommended product strategy for review, not an approved implementation
plan or a statement of shipped capabilities.** This document updates the
positioning recommendations in the September and early October market reviews.
Architecture status comes from [ARCHITECTURE.md](../../ARCHITECTURE.md), especially
§2, §5, §8.15, §9 and §16. It is not a fresh code or production audit.

## 1. The decision

Build LifeKeel into **the family readiness service that helps someone else step
in when the person managing everything cannot**.

Start with one concrete job: help a household organize its essential admin,
share the right information with a chosen backup person, and check that the
handover actually works. Then keep that handover current as records, people and
circumstances change.

The proposed consumer promise is:

> **Your family knows what to do next—even when you cannot handle everything.**
>
> Bring essential records, responsibilities and next steps together. See what
> needs checking, choose what to share, and help someone you trust get prepared.

This is a position to validate, not a claim to an uncontested category. Family
vaults, estate platforms and financial assistants already address parts of it.
The differentiation to earn is **readiness demonstrated through a practical
handover, maintained against current evidence and permissions**.

Three strategic choices follow:

1. Win one household continuity workflow before expanding into an entire
   “family office.”
2. Measure whether another authorized person can find the information and next
   step, rather than whether the primary user filled in a profile.
3. Charge for maintaining that usefulness. Do not rely on selling financial
   products, collecting commissions or maximizing daily app engagement.

## 2. Evidence quality and corrections

This research used publicly searchable primary vendor pages, Product Hunt
listings, Gartner public commentary, ONS statistics, FCA publications and EPO
guidance. The source register records URLs and limitations. Retrieved page
excerpts support the specific claims below; paid Gartner reports were not
accessed, and competitor products were not independently tested.

There are no LifeKeel customer interviews, conversion cohorts, revenue figures
or willingness-to-pay results in this research. Customer selection, proposed
pricing and launch gates are hypotheses. No systematic patent prior-art search
or freedom-to-operate assessment has been performed.

Several earlier recommendations were too confident:

| Earlier claim | Correction and implication |
|---|---|
| “Proactive AI is our unique advantage.” | Origin explicitly describes proactive checks across cash flow, protection, education and estate planning [S3]. OpenAI lists weekly financial updates [S4]. Proactivity is becoming an expected capability. |
| “Trustworthy only stores and answers questions.” | Its site describes a connected household information model, insights, reminders, sharing and emergency access, including offline documents [S1]. Treat it as a direct competitor. |
| “Empathy acts after a loss; LifeKeel owns before.” | Empathy LifeVault includes planning before a loss [S2]. That dividing line is invalid. |
| “Competitors are single-user products.” | Monarch supports household collaboration and individual/partner/shared views [S5]. Family sharing is not unique, and public pages do not establish competitors' internal data models. |
| “Low Product Hunt votes prove death-related positioning fails.” | Launch exposure, featuring, audience and timing differ. Votes do not establish retention or demand. My-legacy.ai's listing reports a #2 daily rank [S6]; even that does not prove commercial success. |
| “Open Finance gives us pension and policy APIs in 2027–2028.” | The FCA roadmap is a programme of development, not a guarantee of particular APIs or LifeKeel's access. Operating a pensions dashboard is itself regulated [S9–S10]. |
| “Approval history should earn more financial autonomy.” | Approval history cannot expand authority. Consequential actions retain explicit approval; advice, arranging and payment initiation remain outside scope. |
| “Our receipt chain, gateway or erasure process is patentable.” | These are invention hypotheses at most. Approval workflows, idempotency, key destruction and recovery controls have substantial existing practice. Technical specificity alone does not establish novelty or inventive step. |
| “A timed emergency release is a new mechanism.” | Bitwarden documents trusted-contact emergency access with a waiting period [S12]. It is an existing pattern, and inactivity alone must not trigger LifeKeel document disclosure. |
| “On-device AI plus envelope encryption means zero knowledge.” | Server-readable data remains server-readable. On-device processing, encryption at rest and client-held encryption have different guarantees and recovery trade-offs. |

Do not reuse the earlier chatbot-error percentages, “only product” statements,
wealth-transfer totals or predicted consumer trust rebound as strategic facts.
The cited evidence does not establish those broad conclusions. In particular,
an enterprise AI cancellation forecast does not predict consumer buying behavior.

## 3. Market analysis: what is becoming common, and what remains difficult

### 3.1 Competitive structure

| Competitor or substitute | Publicly documented proposition | Why a family chooses it | Implication for LifeKeel |
|---|---|---|---|
| ChatGPT Finances | Connected account context, financial questions, dashboards and weekly updates; US availability [S4] | Broad assistant already in use; low incremental friction | Financial chat and summary features are weak reasons to subscribe separately. US availability is not proof of equivalent UK availability. |
| Origin | Proactive checks, financial health score, prioritized actions and estate planning [S3] | Broad financial planning and guidance | Neither a score nor proactive protection checks is sufficient differentiation. |
| Monarch | Household aggregation, budgets, collaboration and shared views [S5] | Partners want a common view of money | Avoid building a second transaction-category manager. Complement existing budgeting tools. |
| Trustworthy | Family records, connected information, automated organization, reminders, permissions and emergency access [S1] | Organized information that others can access | Closest product overlap. LifeKeel must demonstrate an outcome beyond organization and reminders. |
| Everplans and Cake | Guided planning, shared records and trusted-person access [S11] | Preparation and accessible instructions | Checklists, a vault and trusted contacts are established expectations. |
| Empathy / LifeVault | Estate preparation plus support through loss, with institutional distribution [S2] | Help from a trusted existing benefit/provider | Both product breadth and distribution are threats. Avoid claiming the entire before/after-loss journey. |
| Famnest | Family schedules, information and bills [S6] | Everyday coordination | Do not broaden into calendars, chat and general household productivity to manufacture engagement. |
| Sunset | Account discovery and estate settlement after death [S6] | Completion of an urgent, specific task | Narrow jobs are easy to explain. Its account-closing/money-transfer work is outside LifeKeel's boundaries. |
| Shared drive + spreadsheet + password manager + family messages | Familiar tools assembled by the household | Already paid for, flexible, no migration | The real baseline is often “good enough.” LifeKeel must save more effort than setup creates. |

Vendor descriptions establish offered capabilities, not quality, adoption or
customer outcomes. Absence of a feature from a page is not proof it is absent
from the product. Regional availability must be checked separately.

### 3.2 What Gartner contributes

Gartner's public forecast says over 40% of agentic AI projects will be cancelled
by the end of 2027 because of cost, unclear value or inadequate risk controls.
It also warns about “agent washing” and use cases that do not need agents [S7].

For LifeKeel, this supports bounded workflows, measured outcomes and keeping
deterministic computation authoritative. It does **not** validate household
demand, establish LifeKeel's uniqueness or justify an “earned autonomy” marketing
claim. Reliability must first be observable in the actual service.

### 3.3 What Product Hunt contributes

The sampled primary listings show three useful framing patterns [S6]:

- Famnest describes a recognizable everyday coordination problem.
- Sunset describes one urgent outcome: finding and closing accounts after death.
- My-legacy.ai combines planning, a score and AI; these concepts already have
  competitors, including a vendor assertion of pending patents.

Use Product Hunt to collect customer language, objections and comparable
onboarding ideas. Do not use its ranks to estimate market size or choose between
“everyday” and “crisis” positioning. The sample is small, selected and not
representative of paying families. Patent assertions on a launch page are not
evidence that patents were granted or cover a particular mechanism.

### 3.4 Structural demand and uncertainty

ONS estimates 1.4 million UK sandwich carers aged 16–64 for the 2021–2023 study
period; 64% cared for an adult outside their home [S8]. This supports examining
coordination across households. It does not mean 1.4 million households will pay,
nor that these people want financial software.

The UK had an estimated 29.0 million households in 2025 [S13]. That is population
context, not LifeKeel's serviceable market. The initial market must be narrowed
by an actual admin problem, willingness to involve someone else, geography,
ability to pay and a reachable acquisition channel.

Open Finance may reduce future collection friction [S9]. The core value must
work with selected records and declarations even if APIs arrive late or remain
commercially inaccessible. Increasing provider automation strengthens the case
for clear source evidence and permissions, but an agent-to-agent economy is an
option to monitor, not a dependency of the two-year plan.

## 4. Target customer and geography

### 4.1 Initial customer

**The household organizer who wants a partner or trusted adult to be able to
step in.** Likely recruiting profiles include parents with bills, insurance and
important documents spread across services, and adults beginning to help an
older parent with admin.

The qualifying behavior matters more than age or wealth:

- One person holds most of the practical knowledge.
- A recent event made that dependence visible: travel, a move, parental leave,
  taking on family admin, or a change in responsibilities.
- A second adult is willing to take part in a short handover.
- The household can name a concrete task that would be difficult without the
  organizer.

The initial buyer is usually the organizer; the second person's ability to use
the result is the proof of value. Do not assume the buyer can consent on behalf
of another adult, that partners share everything, or that the “organizer” owns
everyone's records.

Families already in acute bereavement or a disputed capacity/ownership situation
are not the initial self-service cohort. They may need specialist human support
that this product does not provide. Single adults with a chosen trusted person
should remain eligible; a spouse must not be a product prerequisite.

### 4.2 Geography recommendation

Use **one jurisdiction for the first commercial cohort**. UK English is the
working research hypothesis because this review has UK demand and policy
evidence; it is not an already-decided launch market.

The existing October PRD review notes a Slovenian product presence and gaps in
localisation and currency support. If the founder can recruit and support
Slovenian families materially more easily, that access may outweigh UK market
size. Compare actual recruitment and payments before committing.

For the first 30 days, compare two small recruitment funnels: UK English and the
existing local audience. Choose one based on qualified recruitment cost, support
effort, paid interest and readiness of jurisdiction-specific content. Do not
launch financial calculations across both markets with untranslated assumptions.
The US competitors inform competitive direction; they do not establish UK or
Slovenian market penetration.

## 5. Positioning and the product experience

**Category descriptor:** family readiness service.

**Entry offer:** a family handover check.

**Long-term role:** keep the household's essential information and responsibilities
usable by the people it chooses, through ordinary changes and difficult moments.

Internal terms such as “digital twin,” “agent gateway” and “disclosure matrix”
explain implementation. They do not communicate the initial purchase.

The proposed first experience:

1. Choose one practical concern, such as “Could someone find our essential bills
   and contacts if I was away?”
2. Add a small set of records or document locations. Uploading everything and
   connecting a bank or mailbox are optional.
3. Review extracted facts, uncertainties and who may see them.
4. Invite a chosen person to an explicitly shared, limited view.
5. Ask that person to find three agreed items or next steps without coaching.
6. Fix what was missing, unclear, inaccessible or out of date.
7. Maintain the result through targeted reminders and material-change checks.

The product should distinguish **recorded**, **confirmed**, **shared** and
**successfully found by the chosen person**. Uploading a will does not establish
its legal validity. Finding a bank's contact information does not grant authority
over an account. Completing a drill does not certify overall financial safety.

### Message tests

Test these sequentially with the same audience and comparable offers:

- “Make family admin easier to share.”
- “Could someone you trust find what matters if you were unavailable?”
- “Keep your family's essential information ready as life changes.”

Choose using completed handovers and paid continuation, supported by interviews.
Click-through alone rewards fear or curiosity. Avoid using alarm, a red score or
an artificial deadline to drive purchases.

## 6. Product patterns worth developing

The following are proposed applications of established technical ideas. They
are not assertions of newly invented or patentable patterns.

### 6.1 Rehearse readiness

Business continuity practice distinguishes owning a recovery plan from exercising
it. Apply that discipline to a bounded family workflow: check whether an authorized
person can actually find the required record and understand the recorded next step.

**Potential advantage:** demonstrable usability beyond checklist completion.

**Architecture addition:** a handover exercise referencing selected records,
permission versions, observed results and unresolved items. Exercises run without
external actions or new access grants.

**Test:** compare time and success on the same agreed tasks using the household's
existing tools and LifeKeel. Count facilitator help. If a shared folder performs
equally well, the product has not earned the differentiation.

### 6.2 Keep conclusions tied to current evidence

A document can remain in a vault while its dependent plan becomes stale. Track
which facts, permissions and instructions support each readiness statement.

Example: a household changes its nominated contact or replaces a policy record.
The related handover items become “needs recheck.” They cannot stay verified
solely because last month's exercise passed. A lost connector marks its facts
stale; it does not prove that a policy or account ceased to exist.

**Architecture addition:** evidence provenance, effective dates, freshness policy,
dependency tracking and invalidation. Reuse the existing detector/lifecycle
engine; a graph database is not required.

**Test:** synthetic changes invalidate the affected conclusions, preserve
unaffected ones, and identify unknowns correctly. Measure both correctness and
recomputation cost.

### 6.3 Share a useful answer without sharing every underlying record

A trusted adult may need an approved contact and a document's location, while a
partner may need a broader view. “Family member” is not sufficient authorization.

**Architecture addition:** grants scoped by person, purpose, record/field and
expiry. Apply those rules to derived summaries, notifications, search and exports,
not just document routes. Revoke dependent views and cached results when grants
change. A summary must not reveal facts hidden in its underlying sources.

**Test:** an unauthorized viewer cannot infer sensitive information from an
alert title, aggregate score or assistant answer. Withdrawal affects subsequent
service access; previously downloaded copies cannot be remotely recalled.

### 6.4 Maintain readiness without demanding frequent attention

Show which agreed checks ran, which could not run, what changed and what needs a
person's attention. A quiet period can be a successful outcome.

**Architecture addition:** monitoring coverage and freshness separate from the
financial/readiness score, bounded notification budgets, observable job and
delivery failures, and an honest degraded state.

**Test:** low alert volume with useful findings and retained subscriptions.
Never translate “no new data” into “everything is fine.”

### 6.5 Extend to independently controlled households

An older parent should be able to share selected admin information while keeping
their own account and control. An adult child's subscription must not confer
ownership over a parent's information.

**Architecture addition:** explicit grants between independently controlled
tenants, separate membership/lifecycle state and revocation propagation.

**Test:** a grant can be understood, narrowed and withdrawn independently; a
household split does not strand or expose the other person's records. This is a
later expansion because its permission model is materially harder.

### Anti-patterns to reject

| Temptation | Why it weakens the strategy | Better decision |
|---|---|---|
| “AI that runs your family's finances” | Creates an expansive promise and conflicts with product boundaries | Describe the exact checks, drafts and approved actions supported |
| Ever more detectors and dashboards | Adds breadth without proving useful handover | Prioritize failures observed in real household tasks |
| One universal readiness percentage | Hides missing evidence and can imply unjustified certainty | Show specific results, assumptions, unknowns and freshness |
| Greater autonomy after repeated approvals | Confuses confidence with authority | Explicit consent remains action-specific |
| Infer illness, pregnancy, death or incapacity from transactions/inactivity | High sensitivity and unreliable inference | Use explicit declarations and existing authorization; no inferred disclosure trigger |
| Sell renewals or steer users to policies | Erodes neutrality and crosses the arranging boundary | Explain changes in records and prepare questions for an existing provider |
| Automatic emergency unlock | Can expose information irreversibly on a false trigger | Pre-authorized sharing and reviewed requests; no timer-only release |
| “Zero knowledge” everywhere | Incompatible with server-readable processing paths | Explain which data is sealed, processed locally or processed by approved services |
| Build an A2A platform now | No proven customer dependency | Keep integrations narrow until a specific workflow and partner justify them |

## 7. Business model and route to market

### 7.1 Revenue

Test a household subscription that includes the chosen backup person's normal
participation. Per-seat pricing discourages the behavior that creates value.

A reasonable **experiment**, not a market-validated price, is approximately
£8–£12 per month or £80–£120 per year for a UK cohort. Test one simple paid offer
at a time. A short free handover check should reveal a useful result; ongoing
maintenance and expanded records can justify payment if they create recurring
value. Export and revocation should not become retention traps.

If households value setup but will not pay for maintenance, test a paid setup
service plus optional periodic review. Do not manufacture subscription value
with unnecessary notifications.

Later, employers or other organizations could sponsor access at a flat fee.
The sponsor gets no household content, individual readiness scores or sensitive
event reports. Even aggregate reporting needs disclosure and safeguards against
identifying small groups. Any channel relationship must preserve the ban on
product steering and commission-led arranging.

### 7.2 Acquisition sequence

1. **Founder-assisted cohort:** recruit organizers with a recent, concrete admin
   problem. Observe the second person's experience, including setup friction.
2. **High-intent practical content:** demonstrate a family handover checklist,
   organizing essential contacts and reviewing document access. Measure completed
   handovers from the content, not page views.
3. **Customer introductions:** make it easy for a satisfied household to tell
   another family. A backup person's invitation is product use, not evidence of
   viral acquisition.
4. **Small employer/carer-support pilots:** only after consumer activation works.
   Compare procurement and support effort with direct acquisition.
5. **Professional handoff:** user-selected, reviewed factual summaries may help
   a solicitor or other licensed professional. No marketplace of recommended
   policies/providers and no assumed hours-saved claim.

Product Hunt can recruit testers and expose unclear messaging. It should not be
the recurring acquisition plan for a sensitive family service.

### 7.3 Economics without an invented TAM

At a hypothetical £100 annual household price, 1,000 paying households produce
£100,000 annual subscription billings; 10,000 produce £1 million. These are
arithmetic scenarios, not forecasts, and exclude taxes, refunds and costs.

Work backward from actual channel performance:

> Qualified households reached × activation rate × paid conversion = new paying households.

Track support/onboarding labor, storage, AI, messaging, payment fees, refunds and
security operations. Gross margin and acquisition payback must include the
human assistance needed to obtain a successful handover.

A proposed scaling guardrail is at least 70% gross margin after direct service
costs and acquisition payback within 12 months, using conservative retention
assumptions. These are management targets to test, not observed benchmarks.
Early annual subscriptions do not prove annual renewal or lifetime value.

## 8. Two-year roadmap, with a conditional third year

Assume a small product/engineering team: one major product bet at a time. Keep
the modular monolith and existing detector/gateway architecture. This strategy
does not require a general agent framework, new foundation model or immediate
database migration.

| Horizon | Outcome to earn | Product focus | Exit evidence |
|---|---|---|---|
| Next 90 days: late 2026–early 2027 | A family can complete and value one handover | Small record set, reviewed sharing, observed handover, payment test and measurement | Second-person success, willingness to pay, support burden, permission failures understood |
| 2027 | That handover remains useful after circumstances change | Evidence freshness, dependency invalidation, low-noise checks, understandable failures, reliable limited access | Changes correctly flag affected items; households continue paying across repeated review cycles |
| 2028 | The service supports wider family responsibilities without over-sharing | Independently controlled linked households, lifecycle transitions, factual professional export, limited sponsor pilots | Consent/revocation proven; incremental paid value; channel and support economics work |
| 2029, conditional | Families can maintain continuity across more services and circumstances | Selected authorized data integrations, document-change explanations, portable continuity packs, selective local processing | Customer demand and lawful access established; reliability, privacy and economics survive expansion |

The 2029 direction is an option, not a commitment to an autonomous financial
family office. If linked households prove unnecessary, deepen the original
household workflow instead.

### Architecture priorities that serve this roadmap

The architecture already documents household/member records, deterministic
detectors and scenarios, reviewed extraction, role-aware views, action previews,
receipts and a governed AI gateway. These reduce implementation risk; they are
not proof of adoption or production reliability.

Complete the relevant foundations before making stronger service claims:

- Disclosure rules across derived outputs, not just source-record access.
- Reliable monitoring/delivery and recovery; expose unavailable checks.
- Provider processing/retention enforcement and accurate privacy claims.
- Member lifecycle, source freshness, timezone and chosen-jurisdiction semantics.
- Task evaluation that distinguishes factual correctness from user acceptance.

The existing [PRD market review](prd-set-market-review-2026-10.md) covers overlap
with the onboarding, retention, privacy and ingestion PRDs. Reconcile new work
with those requirements. New behavior should become a reviewed intent/PRD;
this document does not silently change the architecture's shipped-status claims.

Open Finance is optional infrastructure. Do not operate a regulated pensions
dashboard or assume using a provider exempts LifeKeel from authorization.
Any integration must fit the permanent informational boundary. Manual records
remain a valid fallback, not merely a temporary defect.

## 9. Validation plan and decision gates

**Primary outcome:** a current, authorized and successfully demonstrated family
handover for the agreed essential tasks.

Count a handover as current only while its required evidence is within its
declared freshness policy, its grants remain valid, and relevant changes have
not invalidated it. “Current” applies to those tasks, not the entire family's
financial or legal preparedness.

Track the following separately:

- First-value time, including the primary and backup person's effort.
- Successful task retrieval without organizer/facilitator intervention.
- Unresolved unknowns and proportion of checks using current evidence.
- Material changes correctly detected; false alerts and missed changes.
- Trial-to-paid conversion using all eligible trial households as denominator.
- Paid retention at 90 and 180 days, with cancellations and reasons.
- Direct cost and support minutes per maintained household.
- Access-control, advice-boundary and unauthorized-action failures.

### First 90 days

| Period | Work | Decision it resolves |
|---|---|---|
| Weeks 1–2 | Interview 15 organizers and 10 potential backup people; ask about the last real admin problem and existing workaround | Is the proposed job frequent/important enough, and will the second person participate? |
| Weeks 3–4 | Compare two recruiting audiences; run 10 paired existing-tools versus LifeKeel handover exercises with a small, consented record set | Which geography/channel is reachable? Does the workflow improve actual retrieval? |
| Weeks 5–8 | Enrol a total cohort of 30 households; offer one paid continuation; record every drop-out and facilitator intervention | Does perceived value turn into behavior and payment? |
| Weeks 9–13 | Observe maintenance, user corrections, simulated changes and continued payments | Is ongoing maintenance useful enough to support a subscription? |

Proposed directional gates for the 30-household cohort: at least 20 complete
setup, 12 demonstrate a successful handover, and 10 pay to continue. At least 8
of those payers should remain after **each has reached** 90 paid days; that
retention readout will extend beyond the initial 90-day research programme.
Set the gates before recruitment and report raw counts. This is product
discovery, not a statistically powered market experiment.

Do not scale acquisition until severe permission failures are addressed,
customers understand the limited scope, and the value does not depend on
unpriced manual work.

### What would change the strategy?

| Finding | Response |
|---|---|
| Families will upload documents but backup people will not participate | Simplify the recipient experience; test retrieval without a full account setup where safe. If the problem persists, reassess the handover thesis. |
| Existing folders perform equally well | Focus on maintaining freshness and permissions; stop claiming a better handover until measured. |
| People pay once but reject maintenance | Test a setup/review business; avoid forcing a SaaS model. |
| Employer pilots activate poorly | Stop treating distribution contracts or covered lives as usage. Improve the initial experience before further sales effort. |
| Trustworthy/Empathy ships comparable exercises | Compete on measured usability, jurisdiction fit, service quality and acquisition—not a novelty claim. |
| Customers mainly ask for switching, advice or money movement | Refer them to appropriate licensed services. Do not expand LifeKeel across its permanent boundary. |
| Data feeds are delayed or inaccessible | Continue with selected documents/declarations and visible freshness limits. |

## 10. Defensibility and intellectual property

The plausible moat is an accumulated ability to maintain correct, usable,
permissioned family workflows: a well-designed domain model, observed task
failures, excellent recovery and sharing behavior, credible service operations
and a distribution channel that acquires paying households economically.

These advantages must be earned. More stored family data is not automatically
a moat; users must retain portability and control. Personal/family content must
not train shared or third-party foundation models. Improve the product through
synthetic fixtures, consented usability research and appropriately minimized
operational evidence.

Three mechanisms could justify **investigation**, not a patentability claim:

| Candidate | Technical question to investigate | Relevant existing practice / risk |
|---|---|---|
| Permission-aware invalidation of derived family outputs | Can revocation reliably invalidate dependent summaries, caches, notifications and access proofs while preserving unaffected work? | Information-flow security, dependency graphs and cache invalidation are established fields |
| Minimal evidence for a scoped handover exercise | Can a system establish that an authorized person retrieved an approved subset without disclosing unnecessary underlying information? | Access attestations, selective disclosure and rehearsal/testing systems have extensive prior work |
| Version-bound readiness evaluation | Can evidence, policy and permission changes invalidate exactly the affected conclusions with measurable correctness/resource benefits? | Incremental computation and truth-maintenance mechanisms are established |

EPO guidance stresses technical effect and the essential technical features of
computer-implemented claims [S14]. A family use case, novel marketing term or
combination of familiar features alone does not establish inventive step.
Novelty, eligibility, inventive step and freedom to operate are separate questions.

If a prototype reveals a specific non-obvious mechanism, preserve dated design
notes, inventor contributions, alternatives and comparative measurements. Have
patent counsel conduct a claim-level prior-art assessment before deciding to
file or disclose details. Public disclosure rules vary by jurisdiction; do not
assume a universal grace period. “Whoever files first owns it” is not a sound
description of patent rights.

## 11. The vision

By the end of 2028, the intended customer experience is:

> “We know where the important information is. The people we choose can find
> what they need. When something changes, we know which parts to check again.
> We do not have to keep the whole plan in one person's head.”

That outcome connects everyday admin relief, family preparedness and longer-term
continuity. It is specific enough to test now and broad enough to expand across
generations without turning LifeKeel into a financial adviser or arranger.

The next investment decision should be driven by observed family handovers and
paid continuation, rather than another broad feature inventory.

## 12. Source register

All sources below were retrieved through public web search on 20 October 2026.
Vendor capabilities are vendor claims; listings and pages can change. Only the
public Gartner material below was used. The list is a targeted research sample,
not an exhaustive market census or patent search.

| ID | Source | Supports / limitation |
|---|---|---|
| S1 | Trustworthy [home](https://www.trustworthy.com/), [FAQ](https://www.trustworthy.com/faq), [mobile capabilities](https://www.trustworthy.com/download) | Connected family information, reminders, sharing, emergency/offline access. Vendor descriptions; no independent workflow test. |
| S2 | Empathy [estate planning](https://www.empathy.com/platform/estate-planning), [LifeVault introduction](https://www.empathy.com/blog/introducing-lifevault-a-major-milestone-in-our-mission-to-help-families), [insurance channel](https://www.empathy.com/business/life-insurance) | Planning before loss and institutional distribution. Does not establish availability of every feature in every jurisdiction. |
| S3 | Origin [proactive AI Advisor](https://support.useorigin.com/hc/en-us/articles/48757450425357-How-does-Origin-s-proactive-AI-Advisor-work), [monitoring](https://support.useorigin.com/hc/en-us/articles/48757693613837-How-does-Origin-monitor-my-finances), [estate planning](https://useorigin.com/products/estate-planning) | Proactive checks, scores, actions, estate offering. Support pages dated 8 September 2026. |
| S4 | OpenAI [Finances announcement](https://openai.com/index/personal-finance-chatgpt/), [help](https://help.openai.com/en/articles/20001222-finances-in-chatgpt) | US financial-account context and weekly updates; announcement updated 2 October 2026. No assertion of universal availability or correctness. |
| S5 | Monarch [couples](https://www.monarch.com/for-couples), [Shared Views](https://www.monarch.com/blog/shared-views) | Household collaboration and differentiated views; Shared Views announcement dated 22 October 2025. Does not expose internal authorization architecture. |
| S6 | Product Hunt [Famnest](https://www.producthunt.com/products/famnest), [Sunset](https://www.producthunt.com/products/sunset-4), [My-legacy.ai](https://www.producthunt.com/products/my-legacy-ai) | Positioning examples and direct overlap. Ranks/reviews are not retention, revenue or representative demand evidence. |
| S7 | Gartner [25 June 2025 forecast](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027), [reliability before autonomy](https://www.gartner.com/en/articles/ai-agent-reality-check) | Enterprise agentic AI risk and value discipline; not a forecast of family-app adoption. |
| S8 | ONS [Sandwich carers, January 2021–May 2023](https://www.ons.gov.uk/peoplepopulationandcommunity/healthandsocialcare/socialcare/bulletins/sandwichcarersuk/january2021tomay2023) | Historical estimated people and caring patterns. Not households, current paid demand or a serviceable-market estimate. |
| S9 | FCA [Open Finance roadmap](https://www.fca.org.uk/publication/corporate/open-finance-roadmap.pdf), [vision announcement](https://www.fca.org.uk/news/press-releases/fca-sets-out-vision-open-finance) | Direction, phased development and permission dependencies; not guaranteed pension/insurance API access by a particular year. |
| S10 | FCA [PS24/15](https://www.fca.org.uk/publication/policy/ps24-15.pdf) | Operating a pensions dashboard service requires authorization and permission. A scheme connection deadline is not a general third-party access entitlement. |
| S11 | [Everplans](https://www.everplans.com/), Cake [sharing a plan](https://www.joincake.com/blog/sharing-your-cake-end-of-life-plan-with-someone/) | Existing guided planning, reminders and shared access. Vendor descriptions. |
| S12 | Bitwarden [request/grant emergency access](https://bitwarden.com/help/request-and-grant-emergency-access/) | Existing trusted-contact waiting-period mechanism. A relevant comparable, not a complete patent prior-art analysis. |
| S13 | ONS [Families and households, 2025](https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/families/bulletins/familiesandhouseholds/2025) | Population context only; survey estimates have uncertainty. |
| S14 | EPO [further technical effects](https://www.epo.org/en/legal/guidelines-epc/2026/g_ii_3_6_1.html), [computer-implemented claims](https://www.epo.org/en/legal/guidelines-epc/2026/f_iv_3_9.html) | Technical-effect/claim guidance. Does not assess any LifeKeel invention or other jurisdiction's requirements. |
