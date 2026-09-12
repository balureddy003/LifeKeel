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
| **Family Twin** | People, health, protection, financial life, life & assets, context, preferences — six rich domains | One domain, real: family roster (`family-group.ts`) + a financial-profile schema (household, emergency fund, retirement, education funds — `family-financial-profile.ts`). Nothing yet for health, protection-as-its-own-domain, physical assets, travel/context, or explicit decision-rights preferences. |
| **Family Intelligence** | Understand + predict across all domains | Real, for the financial domain only: 4 deterministic YAML detectors (`detectors/family/*.yaml`) evaluated by `@agentoak/engine` — protection gap, education shortfall, emergency-fund adequacy, retirement gap. This *is* genuine Understand/Predict, just single-domain. |
| **Agent Oak (agent layer)** | Decide, act, escalate | Barely exists. Insights surface in an inbox (Decide/Escalate-shaped: "here's what we found, dismiss or act on it yourself") but nothing autonomous happens. The in-app assistant is currently **a hardcoded response map**, not live reasoning — a known, honest gap (see `apps/web/src/lib/api.ts`'s `fetchAIResponse`). |
| **Action Network** | Insurers, airlines, hospitals, banks as real integrations | Doesn't exist. Only generic connector plumbing (email/Gmail scanning) and a dormant Stripe billing integration. |

This isn't a gap to be embarrassed about — it's exactly what a one-domain,
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
  side effects. Everything shipped today lives here.
- **Tier 1 — Decide + Prepare.** Oak drafts something — a checklist, a
  pre-filled form, a draft email — but a human sends/submits it. Still zero
  external side effects. This is the natural next step (e.g., insight →
  inbox item already has this shape; extending it to "draft a claim
  email you can review and send" stays Tier 1).
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

1. **Deepen the financial domain.** Prove Understand→Predict→Decide works
   well in one domain before going wide — richer financial-profile fields,
   better detector coverage, real (not hardcoded) LLM reasoning for the
   assistant, before adding new domains.
2. **Extend into Protection (insurance).** The natural neighbor to
   financial — coverage, gaps, exclusions. Still Tier 0/1: understand and
   prepare, no autonomous claims filing yet.
3. **Introduce Tier 1 "prepare" actions.** Drafts, pre-filled forms,
   comparison options a human reviews and sends. This is where "Agent Oak"
   starts to feel meaningfully different from a dashboard, without crossing
   into liability the product isn't ready for.
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
              ├─ family-inbox.ts                        │  Decide/Escalate surface
              ├─ billing.ts                             │  Stripe (Oak Plus)
              ├─ blog.ts, case-studies.ts, growth-events.ts   Marketing/growth
              └─ metrics.ts                             Prometheus ops metrics
                                                          │
              @agentoak/engine ◄────────────────────────┘
              (YAML detector evaluation — detectors/family/*.yaml)
                  depends on: @agentoak/platform (auth/mongo/telemetry primitives)

              @agentoak/workflows  → connector OAuth schema registry only
                                     (NOT the workflow/automation engine —
                                     that routing surface was removed)
              @agentoak/pipeline   → connector event normalization
              @agentoak/mongodb-adapter, @agentoak/runtime, @agentoak/specifications,
              @agentoak/legacy-compat, @agentoak/conformance, @agentoak/outcome-kernel
                                   → outcome-lifecycle data model plumbing
```

See `SECURITY.md` for the full list of what was trimmed from the original
full copy (trading, SCIM, federated learning, marketplace, goals/workflows
routing, etc.) and why, and each `packages/*/package.json`'s `description`
for that package's specific role.
