# Architecture

## Product vision

> LifeKeel: the autonomous digital twin for your family.
> Keel understands your family's life, protection and preferences,
> anticipates what you may need, and acts on your behalf when it matters
> most.
>
> When life doesn't go to plan, LifeKeel knows what to do next.

LifeKeel isn't meant to be an AI chatbot with a memory. It's meant to
become a *living model* of the family — who they are, what they own, what
protects them, what matters to them, how they make decisions — paired with
an agent that reasons over that model and, within limits, acts on it.

Concretely, the ecosystem rests on three pillars:

- **Crisis resilience.** Evaluate household cash-flow runway, protection
  gaps, and emergency readiness — can this family survive an income
  disruption, a disability, a critical health event?
- **Life-stage digital twins.** A dedicated twin per family member that
  grows with them — career, pensions, education funds, estate milestones —
  not one static snapshot of the household.
- **Proactive intelligence.** Nudges and scenario simulation instead of
  static tracking — "what happens to our runway if a job transition lands
  in six months?" answered before it happens, not after.

### The multi-agent shape

The agent layer isn't one monolith — it's a family orchestrator plus a
micro-agent per member, each scoped to what that member's life stage
actually needs:

```
                          ┌──────────────────────────┐
                          │     KEEL HQ (Keel Agent)   │
                          │ Family Readiness & Vault │
                          └─────────────┬────────────┘
                                        │
           ┌──────────────────┬─────────┴────────┬──────────────────┐
           │                  │                  │                  │
  ┌────────┴────────┐┌────────┴────────┐┌────────┴────────┐┌────────┴────────┐
  │ Primary Earner  ││   Spouse Twin   ││ Child 1 Twin    ││ Child 2 Twin    │
  │ Twin (Career)   ││ (Wealth/Health) ││ (Education)     ││ (Education)     │
  └─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘
```

- **Keel HQ (family orchestrator)** — synthesizes cross-member financial
  dependencies, owns the dynamic **Family Readiness Score** (emergency
  funds, insurance coverage, estate completion) and the **Ask Keel**
  conversational co-pilot.
- **Adult twins** — career income, pension consolidation, term and
  critical-illness cover, tax efficiency, estate planning (wills, power of
  attorney).
- **Youth twins** — inflation-adjusted education funds, savings buckets,
  and progressive financial literacy as children age.

Two supporting subsystems sit beside the agent graph:

- **Digital Legacy & Emergency Vault** — encrypted storage for wills,
  policies, and estate instructions, with emergency proxy delegation and a
  time-delayed release ("dead man's switch") as an explicitly gated future
  capability — see the trust tiers below for why an autonomous release of
  legal documents is among the highest-stakes actions this product can
  take.
- **Automated Ingestion Engine ("AI Memory")** — OCR and metadata
  extraction over uploaded financial files, claims forms, and policy PDFs,
  feeding proposed coverage-status updates back into the twin.

The multi-agent shape refines the four layers below rather than replacing
them: member twins are the Family Twin decomposed per person, Keel HQ and
the micro-agents together are the agent layer, the ingestion engine is the
Observe step industrialised, and the vault is storage today and a gated
Act surface tomorrow.

### The four-layer architecture

```
1. Family Twin        The living representation. Who are we? What do we
                       own? What protects us? What matters to us? How do
                       we make decisions?
2. Family Intelligence The reasoning engine. What's happening? What does
                       it mean? What could happen next?
3. LifeKeel          The autonomous agent — Keel HQ plus the member
                       micro-agents. What should be done? What can I do?
                       What requires permission?
4. Action Network     The external world — insurers, hospitals, banks,
                       airlines, employers, assistance providers — that
                       Keel eventually acts through.
```

### The reasoning loop

```
Observe → Understand → Predict → Decide → Act → Escalate
```

Every one of these steps is a real product surface, not a metaphor:
**Observe** is data intake (documents, email, connectors). **Understand**
is a detector firing. **Predict** is what a detector's `reasoning` and
confidence score represent. **Decide** is picking a response. **Act** is
doing something with an external side effect. **Escalate** is handing a
decision to a human instead of making it — and it's a first-class step, not
a fallback, because it's what makes the rest of this trustworthy.

## Where the vision meets reality today

| Layer | Vision | What's actually built |
|---|---|---|
| **Family Twin** | Per-member twins — adult (career, pension, protection, estate) and youth (education, savings, literacy) — across people, health, protection, financial life, life & assets, context, and preferences | Roster with real adult/child roles, dates of birth, and per-member email invites that activate a member's own login (PRD-123, `family-group.ts`/`family-join.ts`), a financial-profile schema (household, emergency fund, retirement, education funds, policy-level `policies[]` coverage/renewal tracking — PRD-102, `family-financial-profile.ts`), and the Digital Estate Vault (`vault.ts` — AES-256-GCM-encrypted, adult-gated storage for wills and estate documents). Per-member reasoning is real but young: twin read model + member readiness + member-attributed insights + member-scoped Ask Keel + a deterministic nudge persona (`member-twin.ts`, PRDs 117–122, 126), plus a redacted youth twin (`?mode=youth`, PRD-124). Not built: a scheduled/persisted agent loop, literacy curriculum, and the health, physical-assets, context, and explicit decision-rights domains. |
| **Family Intelligence** | Understand + predict across all domains; nudges and scenario simulation | Real for the financial + protection domains: 5 deterministic YAML detectors (`detectors/family/*.yaml`) evaluated by `@lifekeel/engine` — protection gap (including a `policy_renewal_window` rule off the real `policies[]` data), per-child education shortfall, emergency-fund adequacy, retirement gap, and estate readiness (`family_estate_readiness`, PRD-121 — missing will/PoA as persisted insights, evaluated on profile submit and vault upload/delete). The crisis surface exists: life-event playbooks (PRD-108 — seven event types rendered against the live profile), `GET /family/events/:eventId/readiness` backing the What-If tiles, an unreported-life-change nudge (PRD-111), and vault-awareness emails + insights on bereavement/disability/medical events (`life-events/vault-reminder.ts`). The Family Readiness Score is now the composite the vision calls for: `GET /family/readiness` (PRD-114) returns deterministic server-side subscores — emergency fund, protection, retirement, education, and estate (scored from vault `doc_type` coverage, adult-gated) — computed fresh from the live profile on every read, with the open insights that explain each drop riding along. The client keeps the old `100 − penalties` math only as a labeled offline fallback. Scenario simulation is deterministic and now time-shifted + persisted (PRD-115): `POST /assistant/simulate` accepts `monthsUntilChange` and narrates the timing; `POST/GET/DELETE /family/scenarios` (+ a pure-math `/preview`) store inputs and recompute against the live profile on read; the `/events/job-loss` tile is the first-class surface. What's still missing: multi-step sequenced scenarios (a timeline engine, not a single transition) and per-member scenario scoping. |
| **LifeKeel (Keel HQ + member agents)** | Decide, act, escalate — an orchestrator plus per-member micro-agents | One agent surface, not per-member. Decide is real: insights surface in an inbox (Decide/Escalate-shaped). Ask Keel (`POST /assistant/ask`, PRD-101) does live, grounded LLM reasoning over the family's real financial-profile and open-insight data, falling back honestly (`isLive: false`) if the LLM call fails. Tier 1 "prepare, don't send" (PRD-103) has shipped, and life-event playbook steps reuse it. The Act machinery goes further than the tier list used to admit: `POST /insights/:id/approve` executes real actions (`actions/action-executor.ts` can dispatch `send_email`/`send_whatsapp`/`crm_tag` — exercised via detector-declared `action_intents` since PRD-116 — first live intent is a self-send renewal reminder on `policy_renewal_window`), signed one-click approve/dismiss links ship in notifications (`/a/:token`), and two opt-in Tier 3 surfaces exist — `jobs/auto-execute-trusted.ts` (auto-executes `log_only` insights once a scope earns trust) and `jobs/policy-renewal-reminders.ts` (scheduled sends), both gated behind `automation-settings.ts` toggles, off by default. No member micro-agents. |
| **Action Network** | Insurers, airlines, hospitals, banks as real integrations | Doesn't exist. Only generic connector plumbing (email/Gmail scanning) and a dormant Stripe billing integration. |

This isn't a gap to be embarrassed about — it's exactly what a two-domain,
pre-Act-layer digital twin looks like on the way to the full vision. The
roadmap below is about closing it deliberately, not all at once.

Mapped against the vision's named capabilities: **Keel HQ** is the
assistant + inbox + readiness score today. **Member micro-agents** are the
largest structural gap — the roster knows who's an adult or child, and
detectors already consume per-child education data, but nothing holds or
reasons over a member-level model. **The vault** ships minus proxy
delegation and time-delayed release — deliberately: every adult already
has standing access, so `vault-reminder.ts` closes the awareness gap on
crisis events rather than an access gap, and a true dead-man's-switch
needs dedicated design sign-off at the right trust tier. **The ingestion
engine** is live (GPT-4o OCR on uploads and allow-listed Gmail
attachments, proposing `policies[]` updates a human approves — never
auto-applied). **Scenario simulation** is now real and persisted
(PRD-115): `scenarios/calculate.ts` takes a `monthsUntilChange` horizon
(the fund grows or drains under today's numbers until the change lands,
then runway is measured from that balance), `family_scenarios` routes
save named inputs and recompute against the live profile on every read,
and the `/events/job-loss` tile surfaces "if it happened later" with
save-and-track — the first web surface for scenario math.

## Trust tiers for the Act layer

The single biggest risk in this vision isn't technical — it's that "Act" on
family-scale, often regulated domains (money, insurance, health, travel
booking) carries real liability and licensing weight the moment software
actually *does* something rather than *suggests* something. Every feature
that touches the Act layer must be classified into one of these tiers, and
implemented no higher than the tier it's actually earned:

- **Tier 0 — Observe/Understand/Predict.** Pure analysis. Zero external
  side effects. Most of what's shipped lives here: detectors, the family
  roster/financial-profile Twin, the grounded assistant's Q&A.
- **Tier 1 — Decide + Prepare.** Keel drafts something — a checklist, a
  pre-filled form, a draft email — but a human sends/submits it. Still zero
  external side effects. **Shipped** (PRD-103): `POST /insights/:id/prepare`
  drafts an email from an insight's reasoning; the user edits, copies, or
  opens it in their own mail client — the only exits, never a send call
  from this app.
- **Tier 2 — Act with narrow, named, revocable consent.** Keel performs one
  specific, previously-agreed action ("contact your insurer's assistance
  line for travel disruptions") — never a blanket "act for me" grant.
  Requires an explicit per-action opt-in, not a global toggle. The
  machinery exists (`action-executor.ts` dispatch + `action-preview` gate
  + earned-trust counters) and is now exercised: PRD-116 added
  detector-declared `action_intents` — typed intents authoritative over
  the keyword classifier in both directions — and the first live one is
  `policy_renewal_window`'s self-send renewal-reminder email. Family
  free-text actions still classify `log_only`; a declared external intent
  can never auto-execute (`auto-execute-trusted` excludes it outright).
- **Tier 3 — Autonomous, opt-in, reversible/low-stakes only.** A reminder,
  a calendar hold, a family notification. **Shipped, narrowly**:
  `auto-execute-trusted.ts` (only `log_only` actions, only after a scope
  earns TRUST_THRESHOLD human approvals, only with
  `auto_execute_enabled` on) and `policy-renewal-reminders.ts` (opt-in
  scheduled sends, cancellable via `/reminders`). Money, legal, and
  medical actions do not belong at Tier 3 for the foreseeable future —
  possibly ever, without a licensed-partner integration underneath them.

When adding anything agentic, name its tier in the PR description. If you
can't confidently name one, it's not ready to ship.

The vault's envisioned emergency proxy delegation and time-delayed release
("dead man's switch") is the canonical example of why the tiers exist —
autonomous release of legal/estate documents without live human
confirmation is Tier 3-stakes on legal ground. The shipped design
(`vault.ts` standing adult access + `life-events/vault-reminder.ts`
awareness notifications) deliberately stops at Tier 3's "family
notification" boundary until that capability gets its own design sign-off.
Same discipline applies to member micro-agents: a youth twin surfacing a
savings nudge is still Tier 0 analysis — the tier follows the action's
stakes, not the member — while anything acting on a *minor's* behalf
raises the consent bar rather than lowering it.

## Automated Ingestion Engine (the data-intake principle)

The Family Twin's data model is rich by design, but asking a family to fill
out six domains of forms will kill activation before the product proves any
value. **Passive observation — the "AI Memory" layer of documents via OCR,
email scanning, and connected accounts — is the primary intake channel;
manual entry is the fallback**, not the default expectation. This is
already built and load-bearing: `documents.ts` + `ocr/extract.ts` run
GPT-4o vision OCR on uploads (and `jobs/email-scan.ts` sends allow-listed
Gmail attachments through the same pipeline), with
`ocr/profile-mapping.ts` translating extracted fields into proposed
`policies[]`/profile updates that a human explicitly approves — extraction
never writes to the twin unreviewed. Extend this pattern, don't abandon
it, as new domains get added.

## Roadmap (sequencing, not a committed timeline)

1. **Deepen the financial domain.** ~~Prove Understand→Predict→Decide works
   well in one domain before going wide~~ — **done**: real (not hardcoded)
   LLM reasoning now grounds the in-app assistant (PRD-101), and a public,
   unauthenticated readiness-score quiz (PRD-201) runs the same detector
   engine as a growth loop. Next: richer financial-profile fields and
   deeper detector coverage within the domain, ahead of adding new ones.
2. **Extend into Protection (insurance).** **Shipped**: policy-level
   coverage, provider, and renewal-date tracking (`policies[]`, PRD-102),
   with a `policy_renewal_window` detector rule surfacing upcoming
   renewals. Still Tier 0/1: understand and prepare, no autonomous claims
   filing yet.
3. **Introduce Tier 1 "prepare" actions.** **Shipped** (PRD-103): an
   insight can generate a draft email a human reviews and sends
   themselves — Keel never sends on the family's behalf — and life-event
   playbook steps reuse the same mechanism (PRD-108). Next: more action
   types under the same prepare-don't-send discipline.
4. **Close the crisis-resilience loop.** **Partially shipped**: life-event
   playbooks, What-If readiness, the unreported-change nudge, and vault
   reminders cover the *reactive* half, and PRD-115 shipped the proactive
   scenario layer — `monthsUntilChange` horizons, the persisted
   `family_scenarios` collection recomputed on read, and a real surface on
   the job-loss tile. Next: multi-step sequenced scenarios and nudges that
   fire before an event is reported.
5. **Grow member-level twins.** The roster's adult/child roles, per-member
   earners (PRD-104), and now the member twin read model (PRD-117 —
   `GET /family/members/:id/twin` + `?member_id=` insight filter + the
   `/member/[id]` twin section) are the foundation — plus member-scoped
   reasoning on top of it (member readiness PRD-118, per-member pension
   fields and detection PRD-119/120, and member-scoped Ask Keel via
   `member_id` on `/assistant/ask` in PRD-122). The full Adult/Youth
   micro-agent personas from the vision build on that read model, not on
   a new data model — remaining steps are the agent persona itself and
   youth-facing surfaces, not storage or member-scoped data.
6. **Deepen the Family Readiness Score.** PRD-114 shipped the server-side
   composite (emergency fund, protection, retirement, education, estate —
   `GET /family/readiness`). Estate completeness is now detected too
   (PRD-121's `family_estate_readiness`, evaluated on profile submit and
   vault upload/delete), and per-member readiness ships on the twin
   (PRD-118). Remaining: aligning the public readiness quiz with the
   composite's components.
7. **Vault maturity.** Emergency proxy delegation and time-delayed
   release only via dedicated design sign-off at the correct trust tier —
   see the note above. Worth revisiting alongside: whether vault storage
   should move to client-side encryption to match the zero-knowledge
   framing (today's is server-side AES-256-GCM).
8. **Health & Life/Assets domains.** Later, deliberately — health data is
   GDPR special-category and carries the highest sensitivity of any domain
   in the vision; sequence it after the trust/consent model is proven
   elsewhere, not before.
9. **Action Network partnerships.** Mostly a business-development problem
   wearing an engineering costume. Banks (open banking) are the most
   tractable near-term; insurers/airlines/hospitals as real API partners is
   a multi-year effort per category. Tier 2 autonomous actions can't exist
   without this layer underneath them.

## Current implemented architecture

```
apps/web (Next.js, static export → Firebase Hosting)
  └─ calls → apps/api (Fastify) over HTTP
              ├─ auth-users.ts / auth-social.ts        Auth (+ Google/social OAuth)
              ├─ family-group.ts / family-join.ts       Family roster + member invites
              ├─ family-financial-profile.ts            Family Twin (financial domain)
              │    └─ engine.evaluate() ─────────────┐
              ├─ vault.ts                              │  Digital Estate Vault —
              │                                        │  AES-256-GCM, adult-gated
              ├─ life-events.ts + life-events/*        │  Crisis playbooks, What-If
              │                                        │  readiness, nudges (PRD-108/111),
              │                                        │  vault-awareness reminders
              ├─ family-connectors.ts                  │  Email/Gmail connector
              ├─ connector-credentials.ts              │  Generic OAuth plumbing
              ├─ documents.ts + ocr/*.ts               │  Ingestion engine: upload +
              │    jobs/email-scan.ts                  │  GPT-4o OCR (+ Gmail attachments)
              ├─ insights.ts                           │  Family Intelligence output
              │    └─ POST /insights/:id/prepare       │  Tier 1 "prepare" draft (PRD-103)
              ├─ assistant.ts                          │  Ask Keel — grounded LLM Q&A (PRD-101)
              ├─ family-inbox.ts                       │  Decide/Escalate surface
              ├─ readiness-quiz.ts / leads.ts          │  Public readiness quiz (PRD-201)
              │                                        │  + lead capture — same engine
              ├─ billing.ts                            │  Stripe (Keel Plus)
              ├─ operator.ts + operator/*,             │  Ops console, autopilot, queues,
              │    marketing-posts.ts, lifecycle-*     │  marketing + lifecycle email
              ├─ blog.ts, case-studies.ts, growth-events.ts   Marketing/growth —
              │    detector-content-posts.ts                 detector-driven blog content (PRD-202)
              ├─ reminders.ts, push.ts, audit-log.ts   │  Notifications + audit trail
              └─ metrics.ts                             Prometheus ops metrics
                                                          │
              @lifekeel/engine ◄────────────────────────┘
              (YAML detector evaluation — detectors/family/*.yaml)
                  depends on: @lifekeel/platform (auth/mongo/telemetry primitives)

              @lifekeel/workflows  → connector OAuth/credential plumbing,
                                     ConnectorActionExecutor, schema registry
                                     (the WorkflowEngine/WorkflowLoader
                                     automation engine and its 25 legacy
                                     workflow YAMLs were deleted outright on
                                     2026-09-12, not just left unrouted —
                                     see SECURITY.md)
              @lifekeel/pipeline   → connector event normalization
              @lifekeel/mongodb-adapter, @lifekeel/runtime, @lifekeel/specifications,
              @lifekeel/legacy-compat, @lifekeel/conformance, @lifekeel/outcome-kernel
                                   → outcome-lifecycle data model plumbing
```

See `SECURITY.md` for the full list of what was trimmed from the original
full copy (trading, SCIM, federated learning, marketplace, goals/workflows
routing, etc.) and why, and each `packages/*/package.json`'s `description`
for that package's specific role.
