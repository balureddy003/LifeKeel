# Architecture

## Product vision

> Agent Oak: the autonomous digital twin for your family.
> Oak understands your family's life, protection and preferences,
> anticipates what you may need, and acts on your behalf when it matters
> most.
>
> When life doesn't go to plan, Oak knows what to do next.

Agent Oak isn't meant to be an AI chatbot with a memory. It's meant to
become a *living model* of the family — who they are, what they own, what
protects them, what matters to them, how they make decisions — paired with
an agent that reasons over that model and, within limits, acts on it.

### The four-layer architecture

```
1. Family Twin        The living representation. Who are we? What do we
                       own? What protects us? What matters to us? How do
                       we make decisions?
2. Family Intelligence The reasoning engine. What's happening? What does
                       it mean? What could happen next?
3. Agent Oak          The autonomous agent. What should be done? What can
                       I do? What requires permission?
4. Action Network     The external world — insurers, hospitals, banks,
                       airlines, employers, assistance providers — that
                       Oak eventually acts through.
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
| **Family Twin** | People, health, protection, financial life, life & assets, context, preferences — six rich domains | Two domains, real: family roster (`family-group.ts`) + a financial-profile schema (household, emergency fund, retirement, education funds, and a policy-level `policies[]` model for insurance coverage/renewal tracking, PRD-102 — `family-financial-profile.ts`). Nothing yet for health, physical assets, travel/context, or explicit decision-rights preferences. |
| **Family Intelligence** | Understand + predict across all domains | Real, for the financial + protection domains: 4 deterministic YAML detectors (`detectors/family/*.yaml`) evaluated by `@agentoak/engine` — protection gap (including a `policy_renewal_window` rule off the real `policies[]` data), education shortfall, emergency-fund adequacy, retirement gap. This *is* genuine Understand/Predict, just two domains so far. |
| **Agent Oak (agent layer)** | Decide, act, escalate | Decide is real: insights surface in an inbox (Decide/Escalate-shaped: "here's what we found, dismiss or act on it yourself"). The in-app assistant (`POST /assistant/ask`, PRD-101) now does live, grounded LLM reasoning over the family's real financial-profile and open-insight data — no longer the hardcoded response map this doc used to describe — falling back honestly (`isLive: false`) if the LLM call fails. Tier 1 "prepare, don't send" (PRD-103) has shipped: `POST /insights/:id/prepare` drafts an email a human reviews, copies, or opens in their own client — Oak never sends anything itself. Nothing beyond Tier 1 exists; no autonomous Act. |
| **Action Network** | Insurers, airlines, hospitals, banks as real integrations | Doesn't exist. Only generic connector plumbing (email/Gmail scanning) and a dormant Stripe billing integration. |

This isn't a gap to be embarrassed about — it's exactly what a two-domain,
pre-Act-layer digital twin looks like on the way to the full vision. The
roadmap below is about closing it deliberately, not all at once.

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
- **Tier 1 — Decide + Prepare.** Oak drafts something — a checklist, a
  pre-filled form, a draft email — but a human sends/submits it. Still zero
  external side effects. **Shipped** (PRD-103): `POST /insights/:id/prepare`
  drafts an email from an insight's reasoning; the user edits, copies, or
  opens it in their own mail client — the only exits, never a send call
  from this app.
- **Tier 2 — Act with narrow, named, revocable consent.** Oak performs one
  specific, previously-agreed action ("contact your insurer's assistance
  line for travel disruptions") — never a blanket "act for me" grant.
  Requires an explicit per-action opt-in, not a global toggle.
- **Tier 3 — Autonomous, opt-in-by-default, reversible/low-stakes only.**
  A reminder, a calendar hold, a family notification. Money, legal, and
  medical actions do not belong at Tier 3 for the foreseeable future —
  possibly ever, without a licensed-partner integration underneath them.

When adding anything agentic, name its tier in the PR description. If you
can't confidently name one, it's not ready to ship.

## Data-intake principle

The Family Twin's data model is rich by design, but asking a family to fill
out six domains of forms will kill activation before the product proves any
value. **Passive observation (documents via OCR, email scanning, connected
accounts) is the primary intake channel; manual entry is the fallback**, not
the default expectation. This is already the instinct behind the existing
document-upload and email-connector features — extend it, don't abandon it,
as new domains get added.

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
   themselves — Oak never sends on the family's behalf. Next: extend
   "prepare" beyond insights (e.g. event-response checklists) and cover
   more action types.
4. **Health & Life/Assets domains.** Later, deliberately — health data is
   GDPR special-category and carries the highest sensitivity of any domain
   in the vision; sequence it after the trust/consent model is proven
   elsewhere, not before.
5. **Action Network partnerships.** Mostly a business-development problem
   wearing an engineering costume. Banks (open banking) are the most
   tractable near-term; insurers/airlines/hospitals as real API partners is
   a multi-year effort per category. Tier 2 autonomous actions can't exist
   without this layer underneath them.

## Current implemented architecture

```
apps/web (Next.js, static export → Firebase Hosting)
  └─ calls → apps/api (Fastify) over HTTP
              ├─ auth-users.ts / auth-social.ts        Auth (+ Google OAuth)
              ├─ family-group.ts                        Family roster
              ├─ family-financial-profile.ts            Family Twin (financial domain)
              │    └─ engine.evaluate() ─────────────┐
              ├─ family-connectors.ts                  │  Email/Gmail connector
              ├─ connector-credentials.ts              │  Generic OAuth plumbing
              ├─ documents.ts + ocr/*.ts                │  Document upload + GPT-4o OCR
              ├─ insights.ts                            │  Family Intelligence output
              │    └─ POST /insights/:id/prepare        │  Tier 1 "prepare" draft (PRD-103)
              ├─ assistant.ts                           │  Live, grounded LLM Q&A (PRD-101)
              ├─ family-inbox.ts                        │  Decide/Escalate surface
              ├─ readiness-quiz.ts                      │  Public lead-magnet quiz (PRD-201),
              │                                         │  same engine, no auth/signup
              ├─ billing.ts                             │  Stripe (Oak Plus)
              ├─ blog.ts, case-studies.ts, growth-events.ts   Marketing/growth —
              │    detector-content-posts.ts                 detector-driven blog content (PRD-202)
              └─ metrics.ts                             Prometheus ops metrics
                                                          │
              @agentoak/engine ◄────────────────────────┘
              (YAML detector evaluation — detectors/family/*.yaml)
                  depends on: @agentoak/platform (auth/mongo/telemetry primitives)

              @agentoak/workflows  → connector OAuth/credential plumbing,
                                     ConnectorActionExecutor, schema registry
                                     (the WorkflowEngine/WorkflowLoader
                                     automation engine and its 25 legacy
                                     workflow YAMLs were deleted outright on
                                     2026-09-12, not just left unrouted —
                                     see SECURITY.md)
              @agentoak/pipeline   → connector event normalization
              @agentoak/mongodb-adapter, @agentoak/runtime, @agentoak/specifications,
              @agentoak/legacy-compat, @agentoak/conformance, @agentoak/outcome-kernel
                                   → outcome-lifecycle data model plumbing
```

See `SECURITY.md` for the full list of what was trimmed from the original
full copy (trading, SCIM, federated learning, marketplace, goals/workflows
routing, etc.) and why, and each `packages/*/package.json`'s `description`
for that package's specific role.
