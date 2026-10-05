# LifeKeel — Product Review Council: Simulation, Critique & Redesign

As of 2026-09-18 · reviewed by Claude Code

## Methodology & scope

Running the full council process — 12 personas, the 6-step debate-and-redesign loop, plus the 10x / Magic Moment / Trust Moment / Crisis / Autonomy Ladder / Competitor Replacement / Family Value tests — at full depth on all ~25 journeys in this app would produce a document nobody reads and no team acts on. A real review council triages: it spends depth where the stakes are, and moves fast everywhere else.

**Full council (all six steps, every relevant test) — six journeys**, chosen because they carry the product's core promise and its core risk:

1. Emergency Mode → real Life-Event Reporting — the literal "when life doesn't go to plan" moment
2. Decide → Prepare → Act — where autonomy, trust tiers, and the CLAUDE.md safety rule live or die
3. Ask Keel assistant — where hallucination risk meets a family's real financial decisions
4. Financial Profile / Observe→Understand→Predict — the only domain where the Family Twin is real today; if this loop isn't excellent, nothing built on top of it matters
5. Family sharing & secondary-user access — Persona 11's entire premise (spouse/child/caregiver) currently has almost no real implementation
6. First-time onboarding — the one shot at a magic moment before trust is earned

**Condensed pass (autonomy ladder + family-value test + top friction + one 10x idea) — every other journey**, so nothing in the app goes unreviewed, just not at debate-theater length: connect accounts, upload/documents, "What If" scenarios, home dashboard personas, inbox, settings, upgrade, family/member/asset detail, map, support, readiness quiz.

**Ground rule**: every finding here is grounded in the actual codebase (see `user-journeys-acceptance-criteria-gaps.md` for file:line evidence) or in the product's own stated vision (`ARCHITECTURE.md`, `CLAUDE.md`). Where a persona raises a failure mode not yet observed directly in code, it's marked **(hypothetical)** — the council's job is to stress-test the design, not to invent bugs or competitor capabilities that don't exist.

## Journey 1 — Emergency Mode → real Life-Event Reporting

### Step 1 — Define
User: any family member, any persona. Goal: get help handling a real crisis right now. Trigger: Siren button, Cmd+K, or the elderly "Emergency Help" tile. Context: often mobile, often stressed, sometimes acting for someone else. Desired outcome: the user knows what to do next, grounded in their real data, recorded so the family stays coordinated. Business outcome: this is the moment the entire product promise is judged — get it right once and it's the strongest trust/retention driver in the product; get it wrong once during a real crisis and the user likely never trusts Keel with anything serious again. Risk level: highest in the product.

### Step 2 — Walk the existing journey
1. User activates Emergency Mode → overlay opens: "What happened?" + 5 tiles (bereavement, medical, car, property, travel) + a secondary "This is actually happening" button + Cancel.
2a. Tap a tile → routes to `/events/[eventId]`, the hypothetical "What If?" simulator: generic checklist, no server record, sample-flavored guidance, invisible to the rest of the family.
2b. Tap "This is actually happening" → routes to `/life-events` with **no event id carried through** → user re-picks from a smaller, differently-labeled 3-item list (job loss / bereavement / disability) → `reportLifeEvent()` → real, data-grounded playbook at `/life-events/[eventId]`.
3. Keel's understanding: nothing persisted in path 2a; in 2b, only whatever the financial profile already holds — no new context is ever captured about the specific situation (no "tell me what happened").
4. Keel's decision: a static, pre-authored playbook keyed only by event type, not adaptive to details.
5. External action: none — the whole journey is Tier 0/1 today.
6. Failure mode: a user who taps car, property, or travel has **no real-flow equivalent to reach, at all**, regardless of which button they choose next.

### Step 3 — Multi-persona debate

👤 **User** (parent, spouse just had a stroke, mobile, adrenaline up): "I tapped 'Medical' because that's what's happening. Why doesn't this know who's affected, and why did nothing get saved anywhere?"

🎭 **Crisis User**: "I have maybe 30 seconds of calm attention. This shows me a checklist for a generic medical event, not my spouse's actual coverage. I don't have time to realize this is the practice version."

🎨 **UX**: "The overlay's own copy — 'Tap one and I'll guide you through it' — actively tells the user the tiles are the real path. The button that's actually real reads as an afterthought."

🧐 **Critic**: "You call this an autonomous twin that 'knows what to do next,' and in the exact moment that's supposed to matter most, five out of five instinctive taps lead somewhere disconnected from the user's real data. How do you know how often this happens? There's no analytics on either path."

🎯 **Product**: "The two flows exist because 'What If' needs to stay lightweight for casual exploration, and real events need a server record for family coordination."

🎨 **UX**: "That's an engineering distinction, not a user distinction. Nobody in a crisis is thinking 'is this the exploratory version.' They're thinking 'my spouse is in the hospital, help me.'"

🛡️ **Trust**: "And even in the real flow, there's no free-text capture of what's actually happening — no way to say 'car accident, spouse is at County Hospital, kids need pickup.' Keel can't act on context it never asked for."

🤖 **Agent Architect**: "Keel could already infer a lot here — which family member is likely affected (ask, don't assume), which real policies are relevant. None of that happens; the playbook is static by event type beyond swapping in a provider name."

🏆 **Competitor**: "A competitor doesn't need AI sophistication to beat this — just one flow instead of two, with the event type carried through by construction. That's a UX fix, not a research problem, and it's the easiest thing here to copy."

🧪 **QA**: "What happens if the user backgrounds the app mid-flow to take a phone call — does the real report survive as a draft? (Untested; likely lost — no draft-save observed.)"

### Step 4 — Friction
- 🔴 **Blocker**: car / property / travel have no real-flow equivalent at all — the core promise fails outright for 3 of 5 offered categories.
- 🔴 **Blocker**: the visually dominant path (the 5 tiles) leads away from the real, tracked response for every category.
- 🟠 **Major friction**: the event type picked in the overlay isn't carried into `/life-events` — forces a redundant, differently-labeled re-pick mid-crisis.
- 🟠 **Major friction**: no free-text or guided context capture — Keel can't personalize beyond swapping in a provider name.
- 🟡 **Improvement**: no analytics on which path users take — the team can't even measure the blocker above.
- 🔵 **Opportunity**: a single, adaptive "tell me what happened" entry point could unify both flows and let Keel infer the right playbook.

### Step 5 — Redesign
**Current**: two structurally separate, differently-labeled flows; the visually dominant path is the fake one; 3 of 5 categories have no real equivalent.
**Problem**: a user acting on instinct in a real crisis is systematically routed away from the response the product exists to provide.
**Why it matters**: this is the exact moment "LifeKeel knows what to do next" is being judged. Getting it wrong here is a broken core promise, likely a one-time trust loss.
**Improved experience**: collapse to one entry point. "What happened?" → tiles covering the real taxonomy (expand it to match what's offered — medical/hospitalization, accident, property, travel need real playbooks too, not just job loss / bereavement / disability). Every tile creates a real, server-tracked event immediately (Tier 0 — pure record, no external side effect, safe to do unconditionally). "Explore hypothetically" becomes a separate surface reached only from `/events` directly — removed from the crisis path entirely, rather than trying to make two look-alikes distinct under stress.
**Expected outcome**: every tap from the Emergency overlay leads to a real, data-grounded, family-visible response — no dead ends, no redundant re-picks.
**Implementation implications**: extend `EVENT_TYPES` to cover the taxonomy the overlay already promises; pass the picked type through as a route param; add event-path analytics; delete the routing from Emergency Mode into `/events/[eventId]`.

### Step 6 — Challenge the redesign
🧐 Critic: "Every tile creates a real event immediately — what if the tap was accidental under stress?"
🎯 Product: "Add one lightweight confirm on the first screen only ('Reporting: Medical emergency — continue?') — one tap, not a second navigation decision."
🧪 QA: "What if two family members separately report the same real event — does Keel create duplicates?"
🤖 Agent Architect: "Real gap — needs a lightweight de-dupe check (same type + overlapping timeframe + shared family) that offers 'this may already be reported — view it instead?' rather than silently duplicating."
🛡️ Trust: "Redesign is directionally right, but ships only with both the confirm step and de-dupe check — otherwise a dead-end bug becomes a data-integrity bug."
**Resolution**: redesign holds, with a one-tap confirm and event de-duplication as ship requirements, not later polish.

### 10x challenge
Removing the two-flow split *is* the 10x move — a subtraction, not a feature. Second-order: pre-fill the playbook's contact/provider steps from the real financial profile the moment the event is confirmed, so a bereavement report for a family with a known life-insurance policy shows the actual insurer and policy number, with a drafted claim-notification email, in the same screen the event is confirmed on.

### Magic Moment
A family reports a car accident, and in the same screen Keel has already identified the relevant auto policy from the real financial profile and drafted (not sent) a claim-notification email with the real policy number filled in. Achievable today at Tier 1 — no new autonomy required, just connecting data that already exists.

### Trust Moment
Every step stays at Tier 1 (prepare, don't send) — a reasonable person should trust Keel to draft an email, not to trust it to send one to their insurer unseen. The current implementation already respects this; the redesign asks the *existing* autonomy level to reach every event type, not more autonomy.

### Crisis-in-30-seconds test
Today: fails outright for car/property/travel; passes narrowly for the other three only after a redundant re-pick. Redesigned: WHAT HAPPENED (event type, confirmed in one tap) → WHAT TO DO NOW (first playbook step, personalized where possible) → WHAT KEEL IS DOING (any prepared drafts, clearly marked) → WHAT KEEL NEEDS FROM YOU (confirm the affected member, review a draft) — nothing else competes on that first screen.

### Autonomy Ladder
Level 3 (Keel prepares) is the correct ceiling today, and the redesign keeps it there — Level 4/5 only makes sense once a licensed Action Network partner exists underneath, per the roadmap.

### Competitor Replacement
Before Keel: call the insurer, search for the policy PDF, guess who else needs to know, coordinate over a family group chat, repeat information to multiple providers. With the redesign: one confirmed event, one real playbook grounded in real coverage, one shared source of truth. Today's implementation only delivers this for 2 of 5 categories and loses family-visibility to a localStorage-only checklist — both need fixing before this replacement claim is actually true.

### Family Value
Potentially large time savings — but only once the routing gap and the cross-device checklist-sync gap both close. Today, cognitive load is *increased* under stress by the redundant re-pick and unclear labeling — a case where the current build actively works against its own core promise.

## Journey 2 — Decide → Prepare → Act (insight approval & trust tiers)

### Step 1 — Define
User: organizer, reviewing an insight ("your emergency fund is short," "a policy renews next month"). Goal: understand what Keel found, and either act on it themselves or let Keel help. Trigger: an insight surfaced in the inbox or a health-domain page. Starting state: authenticated, some financial-profile data exists. Desired outcome: a correct, low-effort resolution that the user actually trusts. Business outcome: this is the load-bearing loop of the entire product — detector → insight → action is Family Intelligence and LifeKeel in one place. Risk level: high — this is where autonomy and liability concentrate.

### Step 2 — Walk the existing journey
1. Detector fires (YAML rule against the financial profile) → insight created → surfaces in `/inbox` and the relevant `/health/[domain]` page.
2. User reads the insight's reasoning + confidence, decides to dismiss or act.
3. "Act" today means: open `/events/[eventId]` (if it's event-shaped) and hit "Draft a message" → `prepareInsightDraft()` → an editable draft, exits are copy-to-clipboard or `mailto:` only.
4. Separately, entirely unreached by any UI: `POST /insights/:id/approve` exists server-side and, if called, dispatches real SendGrid email, Twilio WhatsApp, and HubSpot CRM tagging via `action-executor.ts` — genuine Tier 2+ behavior with no approval-gate screen anywhere in `apps/web`.
5. Keel's decision confidence and reasoning are shown to the user for insights, but not for the "prepare" draft content itself — the draft is presented as ready text, not as "here's what I inferred and why."

### Step 3 — Multi-persona debate

🛡️ **Trust & Safety**: "There's a live code path — `action-executor.ts` — that can send a real WhatsApp message or tag a CRM record on a family's behalf, reachable by one endpoint, with zero approval-gate UI in front of it. `ARCHITECTURE.md` says 'no autonomous Act exists.' The code disagrees."

🧐 **Critic**: "So the only thing stopping this from firing today is that nobody built the button? That's not a safety design, that's an accident of scope. What happens the day someone wires a frontend to `approve` without also building the gate CLAUDE.md requires?"

🎯 **Product**: "Nothing calls it today — Tier 1 prepare is genuinely all that's shipped."

🛡️ **Trust & Safety**: "Then the dispatch code shouldn't exist yet either. 'Nothing calls it' is not a control — it's the absence of one. The action-executor's own comment says a near-identical pattern (free-text keyword matching triggering real financial/publishing actions) was already deleted once after causing exactly this problem with a different action set. The lesson didn't get applied to email/WhatsApp/CRM."

🤖 **Agent Architect**: "Classify honestly: sending a WhatsApp message or tagging a CRM record on the family's behalf is Execute, not Prepare — regardless of how 'minor' it looks next to moving money. It needs the same named, revocable, per-action consent Tier 2 requires."

👤 **User**: "Honestly, even the Tier 1 'draft a message' I *can* see doesn't explain itself. It hands me finished-looking text. I don't know which parts are my real data and which parts Keel filled in from a template."

🎨 **UX**: "That's the no-hallucination test failing quietly — the draft doesn't visually distinguish USER PROVIDED / RETRIEVED / INFERRED / RECOMMENDATION text from each other."

🏆 **Competitor**: "If I were building against Keel, I'd lead marketing with 'we show you exactly what's real vs. inferred, and we never act without asking' — today Keel could truthfully say that, narrowly, but the moment `approve` gets a frontend without a gate, that claim becomes false, and a competitor or a journalist would have an easy story."

### Step 4 — Friction
- 🔴 **Blocker (latent)**: real Tier 2+ external-side-effect code exists with no approval-gate UI and no dry-run/trust-level settings screen — a direct contradiction of both `ARCHITECTURE.md`'s claim and CLAUDE.md's rule, currently unexploitable only because nothing calls it.
- 🔴 **Blocker (security)**: no visible authorization/consent scoping on `approve` beyond whatever route-level auth exists — worth an explicit audit before any frontend work begins here.
- 🟠 **Major friction**: prepared drafts don't distinguish real family data from inferred/templated content — undermines the no-hallucination principle even at Tier 1, where it should be easiest to get right.
- 🟡 **Improvement**: insight confidence/reasoning is shown for the insight itself but not carried through into the draft it generates.
- 🔵 **Opportunity**: a visible, per-family "trust ladder" screen (the real one — not the onboarding-checklist component currently using that name) could let Keel *earn* narrow Tier 2 permissions over time, exactly as the backend's `trust_level_by_workflow` field already anticipates.

### Step 5 — Redesign
**Current**: Tier 1 prepare is shipped and safe; Tier 2+ execution code exists in the same codebase with no gate, no settings surface, and no audit trail visible to any human.
**Problem**: safety here currently rests entirely on "nobody built the frontend yet," not on an enforced boundary.
**Why it matters**: CLAUDE.md is explicit that this is the one rule that matters most in this repo. A latent violation is still a violation waiting to happen — the next engineer who wires up `approve` for a demo or a shortcut may not know the history in `action-executor.ts`'s own comments.
**Improved experience**: before any frontend ever calls `approve`, ship the approval-gate screen first — one screen per pending action showing exactly what will happen ("Keel will send this WhatsApp message to [real recipient] via [real channel]"), the evidence behind it, and an explicit per-action confirm, never a standing toggle. Pair it with the dry-run/trust-level settings screen the backend already has fields for, so a human can see and control Keel's trust level per workflow, not just per click.
**Expected outcome**: the code and the architecture doc's claim become true again; Tier 2 becomes a real, human-gated capability instead of a dormant liability.
**Implementation implications**: this is process as much as product — recommend treating "build the approval-gate UI" as a tracked prerequisite that blocks any PR wiring a frontend to `approve`, not a nice-to-have that ships alongside it.

### Step 6 — Challenge the redesign
🧪 QA: "What happens if the approval-gate screen itself fails to load, but the user already tapped confirm on a slow connection — does the action fire twice, or not at all?"
🔧 SRE: "And what's the audit trail if a Tier 2 action fires successfully but the confirmation screen crashes right after — does the user have any record it happened?"
🤖 Agent Architect: "Both need idempotency keys on the action-executor calls and a receipt the user can always retrieve — the backend already has a `/receipts` endpoint per the codebase, so this is closer to 'wire it up' than 'design from scratch.'"
**Resolution**: redesign holds, with idempotent execution and an always-visible receipt trail as explicit ship requirements.

### 10x challenge
Not more automation — *provable restraint*. The 10x move is making "Keel never acts without showing you exactly what and why, and only within limits you set" a literal, inspectable product feature (the trust-tier settings screen), not just a policy in a markdown file. That's a differentiator competitors building faster-and-looser can't easily copy without changing their own risk posture.

### Magic Moment
A user opens the (currently nonexistent) trust screen and sees Keel has *already* earned a narrow, specific permission through repeated correct low-stakes preparation — "Keel has prepared 5 renewal reminders correctly; want to let it send these automatically?" — trust that's visibly earned, not asked for on day one.

### Trust Moment
This is the whole journey. A reasonable person would trust Keel to draft an email. Almost no reasonable person would trust an undisclosed system to autonomously message their insurer or tag a CRM record without ever seeing an approval screen — which is exactly the state the code is in today, dormant but present.

### No-Hallucination test (applied to a typical prepared draft)
A draft today mixes, with no visual distinction: FACT (real policy number, if present), TEMPLATE/RECOMMENDATION (boilerplate phrasing), and sometimes nothing where data is missing (silently omitted rather than flagged UNCERTAIN). Redesign requirement: label each substituted field inline (a subtle chip or underline) as real vs. templated, so the user reviewing before sending knows what to double-check.

### Autonomy Ladder
Today, shipped: Level 3 (prepare). Present in code, unshipped-to-UI: Level 5 (execute with predefined authorization) — which is two full rungs above what's been reviewed, tested, or gated. Recommended next real rung: Level 4 (ask for approval, one narrow action at a time) — not Level 5, and not without the settings/audit work above.

### Competitor Replacement
Before Keel: read the insight, manually draft an email, manually send it. With Tier 1 today: Keel drafts, human sends — already a real, modest time save. The bigger replacement story (Keel handles routine renewals and low-stakes coordination autonomously) requires Tier 2, which requires the gate above — not yet earned, but the most defensible differentiation available if built deliberately and disclosed honestly.

### Family Value
Today: modest but real (drafting saves a few minutes per insight, correctly disclosed as "you still send it"). The latent Tier 2 code represents real future value blocked entirely on trust infrastructure, not on model capability — worth prioritizing accordingly.

## Journey 3 — Ask Keel assistant

### Step 1 — Define
User: anyone, any persona (elderly mode's "Ask Anything" tile makes this a primary entry point for the least technical users). Goal: get a trustworthy answer about their family's situation. Trigger: floating button, Cmd+K, "Ask AI About This" from an event page. Desired outcome: an answer the user can act on with appropriate confidence — or an honest "I don't know yet." Business outcome: this is the surface most likely to be screenshotted, quoted back to a spouse, or relied on under stress — its credibility is the product's credibility. Risk level: high — financial guidance presented with false confidence is the textbook AI-product failure mode.

### Step 2 — Walk the existing journey
1. User asks a question → `fetchAIResponse()` → `POST /assistant/ask`.
2. Success + live data → plain chat bubble, `isLive: true`, grounded in real profile/insight data.
3. Non-live → routed to `AIAnswerCard`, which independently re-queries insights via its own 3-keyword matcher (`retire`/`protected`/`job`) — ignoring what `fetchAIResponse` actually returned.
4. If that independent lookup matches → a fully "live-looking" card: confidence dot, "based on your documents," a sources panel.
5. If it doesn't → an honest "Sample answer — connect your data for a personalized response" card.
6. Network failure or backend 500 on step 1 → silent bare `catch`, no console error, no Sentry event — falls through to step 3/4/5 exactly as if there were simply no live answer.

### Step 3 — Multi-persona debate

🧐 **Critic**: "Ask it something during a real backend outage that happens to match one of the three hardcoded keywords, and it answers with a green confidence dot and 'based on your documents.' How is a user supposed to know that's not actually live right now?"

🛡️ **Trust & Safety**: "That's the definition of excessive confidence the review brief calls out by name. It's not even a rare edge case — 'retire,' 'protected,' and 'job' are exactly the kinds of words a stressed user asks about."

🤖 **Agent Architect**: "Worse: this isn't one component failing to handle errors, it's two independent code paths disagreeing about whether the answer is live, and the more confident-looking one wins."

👤 **User** (non-technical, elderly persona, via the 'Ask Anything' tile): "I don't know what 'live' even means here. I just see an answer with a green dot that says it's based on my documents. I'd believe it."

🔧 **SRE**: "And when this happens during an actual outage, nobody on the team finds out — the one call site here skips the app's own error-reporting convention. This could run silently for a long time."

🎨 **UX**: "Separately from the outage bug — even in the honest 'sample answer' state, the user isn't told *why* it's a sample. Is it because they haven't connected data, or because this specific topic isn't covered yet? Those need different next actions."

🎯 **Product**: "The three-keyword fallback was probably meant as a narrow enhancement — 'catch a few more real answers even off the main path' — not as a second source of truth that can override the first."

🏆 **Competitor**: "If I found this in Keel's code during diligence, I'd flag it as the single most reputation-risky bug in the product — not because it's hard to exploit, but because it undermines the one thing Keel is selling: 'trust our reasoning over your family's real situation.'"

### Step 4 — Friction
- 🔴 **Blocker**: a genuine backend outage can render as a confident, live-looking, sourced answer — the worst possible failure mode for a product whose value proposition is trustworthy reasoning.
- 🔴 **Blocker**: zero error observability on this path — an outage here could run indefinitely undetected.
- 🟠 **Major friction**: two independent "is this live" determinations can disagree, and the system doesn't reconcile them — it just shows whichever one looks more confident.
- 🟡 **Improvement**: "sample answer" doesn't explain *why* (no data connected vs. topic not covered) or offer a specific next action per reason.
- 🔵 **Opportunity**: the same architecture (grounded answers + honest fallback) is good bones — the fix is disambiguation and error-reporting, not a rebuild.

### Step 5 — Redesign
**Current**: `fetchAIResponse` failure is indistinguishable from "no live answer for this topic"; `AIAnswerCard` independently overrides that signal.
**Problem**: false confidence during real outages, and a genuine operational blind spot.
**Why it matters**: financial/family guidance presented as grounded when it may not be is the exact failure mode that erodes trust fastest and hardest to win back.
**Improved experience**: one source of truth for "is this live" — `fetchAIResponse`'s result, not a second independent lookup. Three distinct states, visually distinct: LIVE (grounded, sourced), SAMPLE (explicitly — "connect your data to personalize this"), and UNAVAILABLE ("Keel's assistant is temporarily down — try again shortly"), the last one new and currently nonexistent. Route every failure through the same `reportError()` convention the rest of `api.ts` already uses.
**Expected outcome**: a user can always tell the difference between "this is real," "this is a preview," and "something's actually broken" — and engineering finds out about outages the same day, not never.
**Implementation implications**: delete `AIAnswerCard`'s independent insight re-query as an authority on liveness (it can still enrich a genuinely-live answer with sources, just not decide liveness on its own); add the missing `UNAVAILABLE` state and its copy; wire `reportError` into `fetchAIResponse`'s catch block.

### Step 6 — Challenge the redesign
🧪 QA: "What if the backend is up but slow — does UNAVAILABLE fire on a merely slow response, annoying users who just needed to wait a beat?"
🎨 UX: "Keep the existing timeout budget as the threshold, and show a lightweight 'still thinking' state before the timeout, not an immediate UNAVAILABLE."
🧐 Critic: "Does 'connect your data to personalize this' actually help a user who has no idea what data connection even means?"
🎯 Product: "Make it a direct link into the specific missing step — `/upload` or `/financial-profile` — not just copy."
**Resolution**: redesign holds, with a distinct 'thinking' state ahead of the timeout and a direct action link on the SAMPLE state.

### 10x challenge
The 10x move isn't a smarter model — it's radical honesty about certainty, made visually native rather than a footnote: every answer's key claims tagged inline (a real number vs. a general recommendation) so the user never has to wonder which parts to double-check.

### Magic Moment
A user asks "are we protected if I lose my job," and Keel's answer references the family's actual emergency-fund runway and a specific named policy — numbers the user forgot they'd entered months ago. The infrastructure for this already exists (`fetchFamilyInsights`); it just needs to be the *only* path to a live-looking answer.

### Trust Moment
A reasonable person trusts an assistant that says "here's what I know, here's what I'm inferring, here's what I don't have yet" far more than one that always sounds equally confident. The redesign's three-state model is exactly this discipline applied to the UI.

### No-Hallucination test
Applied to a typical live answer today: financial figures are RETRIEVED (real), but nothing in the UI marks them as such versus general RECOMMENDATION text — both render as plain prose. Redesign requirement: at minimum, numbers pulled from the family's real profile get a subtle visual marker (already partially modeled by `MoneyText` formatting — extend it to carry a provenance flag, not just currency formatting).

### Autonomy Ladder
This journey is inherently Level 1–2 (inform/recommend) — correctly so; there's no case for this assistant ever executing actions directly, and nothing in the current design suggests anyone intends that. The ladder question here isn't "how much autonomy" but "how honest is the confidence signal at the level we're already at."

### Competitor Replacement
Before Keel: search engine, a call to an advisor, guesswork. With Keel, done right: one grounded answer referencing the family's real situation, with visible confidence. Today's implementation partially delivers this but undercuts it with the outage-masking bug — fixing that is what makes the replacement claim actually defensible.

### Family Value
High potential — an assistant that's honest about what it knows is genuinely useful for quick judgment calls. Currently undermined by the one bug that matters most here: users can't yet fully trust that "looks live" means "is live."

## Journey 4 — Financial Profile / Observe → Understand → Predict

### Step 1 — Define
User: organizer, typically the digitally-sophisticated or busy-parent persona, sometimes filling this in for the whole family. Goal: get accurate insights without doing tedious data entry. Trigger: onboarding, Home's 0-state CTA, a document-extraction "apply to profile" prompt. Desired outcome: the profile reflects reality with minimum manual effort, and generates insights the user trusts. Business outcome: this is the only domain where the Family Twin is real today — every other journey (insights, assistant, life-events playbooks) is downstream of this data being both present and accurate. Risk level: medium — not physically dangerous, but wrong or stale data here silently degrades every other journey's trustworthiness.

### Step 2 — Walk the existing journey
1. Passive intake (document upload → OCR → extraction) or manual entry via the 4-step wizard — per `ARCHITECTURE.md`'s own data-intake principle, passive should be primary, manual the fallback.
2. Wizard autosaves each step with an optimistic-concurrency `version` guard; final step "Save & Generate Insights" re-runs the detector engine.
3. Applying extracted document fields to the profile is a separate, second action from applying-and-saving — doesn't itself regenerate insights.
4. Insights surface in the inbox / health domains with reasoning + confidence.

### Step 3 — Multi-persona debate

👤 **User** (busy parent, uploaded three insurance documents last week): "I already gave you these documents. Why am I back in a form typing the same numbers?"

🎯 **Product**: "Extraction populates suggestions you can apply — but it's true the wizard itself doesn't know what's already been extracted elsewhere until you explicitly apply it."

🤖 **Agent Architect**: "And even after applying, the user has to separately hit 'Save & Generate Insights' — applying doesn't trigger re-evaluation on its own. Keel *has* the new data and still won't act on it until asked twice."

🧪 **QA**: "What happens on a version conflict mid-wizard — does the user lose their in-progress edits, or see a clear merge/retry path? (Reviewed: version conflict is only surfaced on the *next* autosave, not proactively — a user could type several fields against stale state before finding out.)"

🎨 **UX**: "Autosave failures outside the version-conflict case are silent. A user who loses connectivity mid-wizard has no idea a step didn't actually save until insights don't reflect it later."

🧐 **Critic**: "You market 'passive observation is primary, manual entry is the fallback' — but the fallback is still the only thing that reliably, visibly produces insights in one action. Passive intake quietly requires a second, manual confirmation step. That's not really primary."

🏆 **Competitor**: "The wedge here is obvious: whoever makes 'upload a document, get insights, no second step' actually true first wins the activation race. Right now Keel's manual wizard is honestly fine, but it's not the differentiated path — it's the fallback pretending to be the front door."

### Step 4 — Friction
- 🟠 **Major friction**: applying extracted document data doesn't trigger insight regeneration — breaks the "passive intake is primary" principle at the exact moment it should shine.
- 🟠 **Major friction**: silent autosave failures outside the version-conflict path — a user can believe a step saved when it didn't.
- 🟡 **Improvement**: version conflicts surface reactively (on the next save attempt) rather than proactively (as soon as the server-side change is known).
- 🟡 **Improvement**: no visible link between "I uploaded a document" and "here's exactly what changed in your profile" — the connection is implicit, not shown.
- 🔵 **Opportunity**: this is the natural home for the product's first real Magic Moment — upload once, watch the profile and insights update live, no form at all.

### Step 5 — Redesign
**Current**: two separate manual actions (apply extracted fields, then save-and-generate) stand between a passively-observed document and an actual insight.
**Problem**: the product's own stated principle — passive intake as the primary channel — isn't true in practice; it still routes through a manual gate.
**Why it matters**: `ARCHITECTURE.md` names this explicitly as the thing that prevents activation-killing form fatigue. If it's not actually one-step, the principle isn't shipped, just stated.
**Improved experience**: applying extracted fields to the profile triggers insight regeneration automatically as part of the same action — one tap, both effects, with a visible "3 new insights from this document" confirmation. Autosave failures get an explicit, persistent (not toast-and-gone) indicator per step until resolved. Version conflicts surface the moment they're known, not on the next unrelated save.
**Expected outcome**: uploading a document and seeing a personalized insight becomes a single, visible cause-and-effect loop — the product's clearest demonstration of Observe→Understand→Predict actually working.
**Implementation implications**: merge the apply-and-regenerate calls (or chain them server-side); add a persistent "unsaved" indicator keyed to autosave state; move version-conflict detection to proactive (e.g. a lightweight poll or websocket-free "has this changed" check before allowing further edits).

### Step 6 — Challenge the redesign
🧪 QA: "Auto-regenerating insights on every applied field could get noisy — if a user applies 5 documents in a row, do they get 5 separate insight-regeneration events and notification spam?"
🎯 Product: "Debounce it — regenerate once, a beat after the last apply in a session, not per-document."
🧐 Critic: "Debouncing means the user who applies one document and leaves might not see updated insights for a few seconds. Is that communicated?"
🎨 UX: "Yes — a brief inline 'updating your insights...' state, same pattern as the existing OCR-processing poll."
**Resolution**: redesign holds, with debounced regeneration and an explicit inline processing state.

### 10x challenge
Remove the second action entirely — that's the whole 10x move here, not a new feature. Second-order: proactively suggest which document to upload next based on gaps the detectors already know about ("you're missing a life-insurance policy — upload it and I'll check your protection gap immediately"), turning a generic upload prompt into a targeted one.

### Magic Moment
Upload an insurance document, and within the same screen — no navigation, no second save — see "Your protection gap insight just changed: you're now covered for X." This is achievable with existing pieces (OCR, extraction, the detector engine); it's a wiring problem, not a research problem.

### Trust Moment
Low-stakes here (Tier 0 — pure analysis, no external side effect), so the trust bar is about accuracy and transparency, not permission. The redesign doesn't ask for more trust, it just removes the friction currently standing in the way of the trust the product has already earned the right to ask for.

### Autonomy Ladder
Level 2 (Keel recommends, via insights) is correct today. The redesign pushes toward Level 3 only in the narrow sense of "prepares the next insight automatically," never toward acting on the family's behalf — appropriate, since this whole domain is Tier 0.

### Competitor Replacement
Before Keel: dig up policy PDFs, manually track renewal dates and coverage gaps in a spreadsheet or memory. With Keel, once the redesign closes the two-step gap: upload once, see gaps and insights immediately. Today's implementation is close but the extra manual step undercuts the "materially reduces complexity" claim.

### Family Value
High, and currently the most legitimate value claim in the product — this is the one domain with real detector coverage. The redesign is about making that value visible and immediate rather than adding new value.

## Journey 5 — Family sharing & secondary-user access

### Step 1 — Define
User: a spouse, parent, child/young adult, caregiver, or trusted contact/executor — anyone who isn't the organizer who set up the account. Goal: see what's relevant to them, act within their own boundaries, and understand why they can or can't do something. Trigger: being added via Settings, or (nominally) an invite code. Desired outcome: a real, independent relationship with Keel, not just an entry in someone else's roster. Business outcome: a "family" digital twin that only one person can actually use isn't a family product — this is foundational to the vision, not a secondary feature. Risk level: currently low technical risk only because the feature barely exists; high product risk, because it undercuts the core positioning.

### Step 2 — Walk the existing journey
1. Organizer adds a member via Settings (`inviteMember()`) → pushes a `{status:'pending', name, email, role}` record into the organizer's own family document. No email is sent, no token generated.
2. An `invite_code` is generated and shown to the user (Settings, Home banner: "lets a partner or caregiver join").
3. Nothing consumes that code — no `/family/join` endpoint, no `/invite/[code]` page exists anywhere.
4. Backend explicitly documents that self-serve signup cannot join an existing tenant — every signup mints a brand-new, separate workspace.
5. Persona-mode switching (organizer/parent/child/elderly) exists, but it's a **local preference the organizer sets for themselves**, not a real per-person login with its own permissions.

### Step 3 — Multi-persona debate

👥 **Family Member / Secondary User** (spouse): "You told me there's an invite code so I can join. I typed it in somewhere — nowhere, actually, because there's nowhere to type it. So what was that code for?"

🧐 **Critic**: "The UI actively promises a capability ('lets a partner or caregiver join') that has no implementation behind it at all. That's not a gap, that's a false claim sitting in the product today."

🎯 **Product**: "The roster model was meant to let the organizer represent the whole family's data even before everyone has their own login — useful for young children, at least."

👥 **Family Member** (teenager old enough to want their own access): "Sure, but I'm not five. Why can't I have my own login and see my own education fund without asking a parent to check it for me?" — this is exactly the gap the Home dashboard's child-mode review already found: no self-service path.

🛡️ **Trust & Safety**: "And once a second real login *does* exist, what's the permission model? Right now there's no code path to even ask 'what am I allowed to see' — there's no second identity to scope permissions to."

🎨 **UX**: "Every 'invite' surface in the product — Settings, the Home banner — needs to either be honest about what it currently does (adds a roster entry, doesn't grant access) or not exist until the real thing does."

🏆 **Competitor**: "This is the single easiest wedge to attack Keel's core positioning on. 'Family' twin, single login — a competitor that ships even a basic real multi-user model first gets to credibly claim the thing Keel's own name promises."

🤖 **Agent Architect**: "There's also a data-model question underneath this: today all financial data is household-level, not per-member. Even with real logins, 'what can a spouse see vs. a child' has nothing to attach permissions to yet — this is bigger than auth."

### Step 4 — Friction
- 🔴 **Blocker (trust)**: the invite-code UI promises a capability that doesn't exist — this is a credibility risk independent of the missing feature itself.
- 🔴 **Blocker (positioning)**: "family" is currently one login with a roster attached, not a multi-user product — directly at odds with the stated vision.
- 🟠 **Major friction**: no self-service path for a capable secondary user (teenager, spouse) — everything routes through the organizer.
- 🟡 **Improvement**: persona mode is a shared, local toggle rather than a per-person setting — confusing on a shared family device.
- 🔵 **Opportunity**: the roster + financial-profile foundation is real; a real invite-acceptance flow is additive, not a rebuild.

### Step 5 — Redesign
**Current**: an invite code is displayed and promised, but nothing redeems it; roster entries aren't real accounts.
**Problem**: the product's name and core positioning ("for your family") is undercut by its own auth model.
**Why it matters**: this isn't a nice-to-have — without it, every journey reviewed elsewhere in this document (life-event coordination, family-visible checklists, the Trust Moment principle applied to a spouse instead of just the organizer) is built on a single-user foundation wearing a family-shaped UI.
**Improved experience**: ship a real, minimal invite-acceptance flow first — `invite_code` resolves to a `/invite/[code]` page, lets the invitee create their own login scoped to the existing family (not a new tenant), and immediately removes or rewords every UI surface that currently overpromises this. Pair with a first, narrow permission model: even before full per-member data, a secondary user can at least see the shared family view and their own designated section (e.g. the child's education fund, visible to that child directly).
**Expected outcome**: "family" becomes true in the product, not just the name — unlocking every other journey's family-coordination value (already assumed, e.g. by the life-event checklist's shared-visibility intent).
**Implementation implications**: this is a real scoped project (auth changes, a join flow, a first cut of per-member permissions) — not a quick fix like the other journeys reviewed here; recommend sequencing it explicitly rather than letting it stay implicit tech debt.

### Step 6 — Challenge the redesign
🧪 QA: "What happens if two people redeem the same invite code, or the organizer revokes it mid-signup?"
🤖 Agent Architect: "Standard single-use, expiring token semantics — not novel, just needs building; revoke should invalidate an in-flight signup gracefully with a clear message, not a silent failure."
🛡️ Trust: "Also: what stops a malicious invite (someone forwards their family's code to a stranger)? Needs an organizer-side confirmation step before the new member gets any real access, not auto-grant on redemption."
🎯 Product: "Agreed — redemption creates a pending-approval state, organizer confirms, then access activates. Slower, but matches the same 'prepare, don't auto-execute' discipline used elsewhere in the product."
**Resolution**: redesign holds, with expiring single-use codes and an organizer-confirmation step before access activates — consistent with the product's own Tier-1-first posture applied to permissions, not just financial actions.

### 10x challenge
Not a bigger invite flow — a smaller one: let the *first* real multi-user win be narrow and safe (a spouse gets full access, matching the organizer; a child gets read-only access to their own designated items) rather than trying to design the full six-domain permission matrix `ARCHITECTURE.md` eventually implies. Ship the 20% that unlocks the most real coordination value.

### Magic Moment
A spouse who's never touched the app before gets a life-event notification from the *family's* shared record (not a screenshot forwarded manually), opens it, and sees the same real, personalized playbook the organizer would see — the first time "family" actually means more than one person in this product.

### Trust Moment
Granting a second person access to a family's financial and life data is inherently higher-stakes than anything reviewed in Journeys 1–4. The organizer-confirmation step above is the right instinct: trust must increase as autonomy (here, access) increases, exactly per the brief's own principle.

### Autonomy Ladder (applied to permission-granting, not financial action)
Today: Level 0 — the organizer does everything, including standing in for everyone else's access. Redesign target: Level 4 — Keel (the invite system) prepares access and asks the organizer for one explicit approval before granting it. Not higher — auto-granting access (Level 5+) has no place here.

### Competitor Replacement
Before Keel: shared family knowledge lives in someone's head, a shared spreadsheet, or gets manually screenshotted between family members. With a real multi-user Keel: one shared, permissioned source of truth. Today's single-login model doesn't yet replace anything — it's the single biggest gap between what's promised and what's shipped.

### Family Value
Potentially the highest of any journey in this review, because it's a multiplier on every other journey's value — and currently the lowest-delivered, because it's nearly unbuilt. This is a strong candidate for the single most consequential investment coming out of this review.

## Journey 6 — First-time onboarding

### Step 1 — Define
User: first-time user, any technical level, arriving with zero trust built yet. Goal: get set up fast without feeling interrogated, and see enough value to come back. Trigger: post-signup, or directly if no family exists. Desired outcome: a family record exists, and the user has some early signal Keel is worth their real data. Business outcome: activation — this is the highest-leverage funnel moment in the whole product; every journey reviewed above is worthless to a user who drops off here. Risk level: low technical risk, high business risk (activation loss).

### Step 2 — Walk the existing journey
1. Chat-style Q&A: name, recovery email (validated), marital status, spouse name, children Y/N, children's names.
2. Two account-creation branches depending on whether the user arrived pre- or post-signup, both largely invisible to the user.
3. `createFamily()` then best-effort `inviteMember()` per collected person (partner/children get `email: ''` — roster entries, not real invites, consistent with Journey 5's findings).
4. Success → 2s delay → redirect to `/` (dashboard), which for a brand-new family is mostly 0-states and CTAs to connect/upload/fill in the financial profile.
5. Failure modes: an email collision on the not-yet-authenticated path discards the whole chat session and bounces to `/login`; any other signup error just stalls the chat with no retry button; recovery-email linking failure on the already-authenticated path is silently swallowed.

### Step 3 — Multi-persona debate

👤 **User** (first-time, non-technical): "That was a nice conversation, but now I'm on a page telling me to connect my bank, upload documents, and fill in a financial form. Where did the 'digital twin that understands my family' part go?"

🎨 **UX**: "The chat format sets an expectation — warm, conversational, low-effort — that the very next screen breaks. The tone whiplash from 'chat with Keel' to '4-step financial wizard' is real."

🧐 **Critic**: "And after all that conversation, what did Keel actually learn that it uses? Names and relationships, mostly — nothing yet that produces an insight. The magic-moment opportunity here is currently unclaimed."

🧪 **QA**: "Onboarding collision handling discards the whole chat session and sends the user to `/login` — they redo the entire conversation from scratch after logging in. That's a real abandonment risk at the worst possible moment."

🎯 **Product**: "The conversational format was meant to feel human before asking for data — that instinct is right, it's the handoff to the wizard that's abrupt."

🤖 **Agent Architect**: "Keel already knows, from the chat alone, whether there's a spouse and children — enough to pre-select relevant financial-profile sections (skip 'second earner' questions if no spouse was mentioned, pre-create an education-fund placeholder per named child) instead of presenting a blank generic wizard next."

🏆 **Competitor**: "The easiest way to beat this onboarding isn't a flashier chat — it's making the chat's own answers visibly *do* something immediately, so the user's first impression is capability, not a form."

👥 **Family Member**: "None of this asks who else in the family should eventually get their own access — by the time Journey 5's invite gap is fixed, onboarding should be the natural place to start that, not an afterthought in Settings later."

### Step 4 — Friction
- 🔴 **Blocker**: email-collision path discards the entire onboarding session with no continuity — a first-time user's worst possible early experience.
- 🟠 **Major friction**: abrupt tonal and effort shift from conversational onboarding to a generic financial wizard, with none of the chat's answers visibly shaping what comes next.
- 🟡 **Improvement**: non-collision signup errors stall the chat with no retry affordance.
- 🟡 **Improvement**: recovery-email linking failures are silently swallowed — user has no idea if their account recovery is actually set up.
- 🔵 **Opportunity**: this is the product's best remaining unclaimed Magic Moment — first impressions are disproportionately valuable, and the chat already collects data nothing downstream currently uses.

### Step 5 — Redesign
**Current**: a warm conversational intake followed by a cold, generic financial wizard that ignores what was just said.
**Problem**: the handoff wastes the trust and context the chat just built, and one specific failure mode (email collision) can destroy a first-time user's entire session.
**Why it matters**: activation is the highest-leverage moment in the funnel; the product gets exactly one first impression per user.
**Improved experience**: (1) fix the collision dead end — preserve the collected chat state (client-side is enough) across the redirect to `/login`, and resume the wizard immediately after authentication instead of restarting; (2) carry the chat's answers into the financial-profile wizard as pre-filled context — skip irrelevant sections, pre-populate named family members into the education-funds step; (3) end onboarding with one small, real, visible insight if enough was collected to produce one, even a generic "here's what I'll help you track once you add more" rather than a blank dashboard.
**Expected outcome**: onboarding reads as one continuous, low-effort experience where Keel is visibly already working, not a chat followed by paperwork.
**Implementation implications**: persist onboarding answers (even just in memory/localStorage) across the login redirect; map collected chat fields into wizard pre-fill; add a lightweight "starter insight" or clear next-best-action at the end of onboarding instead of a generic 0-state dashboard.

### Step 6 — Challenge the redesign
🧐 Critic: "Pre-filling the wizard from chat answers — what if the user gave inconsistent info (said 'no kids' in chat, but the wizard later needs a education-fund section)? Does pre-fill create confusing mismatches?"
🎯 Product: "Pre-fill should only skip sections that are unambiguous (marital status → second-earner section), never silently assume numeric values — conservative pre-fill, not guesswork."
🧪 QA: "Persisting onboarding state client-side across a login redirect — what if the user closes the tab instead of completing login? Is there any expiry so stale partial data doesn't reappear days later?"
🤖 Agent Architect: "Reasonable to cap it — expire the persisted draft after a short window (e.g. 1 hour), same spirit as a password-reset token."
**Resolution**: redesign holds, with pre-fill limited to unambiguous fields and a short expiry on the persisted draft.

### 10x challenge
The 10x move is continuity, not more content: make the user feel like they're still talking to the same Keel, not handed off to a form, by carrying context forward visibly ("Since you mentioned Priya and Sam, I've started their sections") rather than starting cold.

### Magic Moment
At the end of onboarding, before any document is uploaded or any wizard step filled, Keel says something specific and correct using only what was said in chat — "You mentioned two kids, Priya and Sam — I'll track an education fund for each once you're ready." Small, but it's proof Keel was listening, on the very first day.

### Trust Moment
Onboarding is Tier 0 throughout — no external action, pure data collection and reflection. The trust question here isn't about autonomy, it's about whether the first impression is competent and continuous. The collision dead end currently fails this on a purely mechanical level, independent of any AI trust question.

### Autonomy Ladder
Level 1–2 (inform/recommend) is correct and sufficient here — onboarding should never ask for or exercise any execution authority. The redesign doesn't change the ladder position, only the quality of the experience at that level.

### Competitor Replacement
Before Keel: a generic signup form, or a competitor's own generic onboarding wizard. Keel's conversational format is already a genuine, if currently underused, point of difference — the redesign's job is to make sure that difference survives past the first two screens instead of being abandoned at the wizard handoff.

### Family Value
Indirect but foundational: onboarding itself saves no time, but a bad onboarding experience is the single most expensive place to lose a family that would have gotten real value from every other journey in this review.

## Condensed pass — every remaining journey

Autonomy Ladder (correct level today → recommended next), Family Value (time/cognitive load), top friction, and one 10x idea — for every journey not given the full council above.

| Journey | Autonomy today → next | Family Value today | Top friction | One 10x idea |
| --- | --- | --- | --- | --- |
| Connect accounts (email/bank) | L1 inform → L3 prepare (auto-suggest what to connect based on detector gaps) | Real for email; zero for banking (blocked) | Open Banking is a coded dead end with no ETA shown to the user | Show the user exactly which insights are blocked by not connecting a bank — make the cost of not connecting visible |
| Upload documents | L2 recommend → L3 prepare (already close) | High when extraction works; zero on free tier (docs never become clickable) | "Will sync when reconnected" promises an offline retry that doesn't exist | Let a failed upload actually retry automatically on reconnect — make the existing copy true instead of removing the promise |
| "What If?" hypothetical scenarios | L1–L2, correctly capped (explicitly non-committal) | Moderate — useful for planning conversations | None significant once separated from Emergency Mode (see Journey 1) | Let a completed "what if" optionally convert into a real reported event in one tap, once the taxonomies are unified |
| Home dashboard (organizer view) | L2 recommend | High when data exists, honest 0-state otherwise | `MemoryPrompts` sample cards sit next to real ones with only a small label distinguishing them | Replace static sample cards with the same "what's missing to make this real" prompt used elsewhere, so every card either informs or asks — never just decorates |
| Home dashboard (child mode) | L1 inform, with no path forward | Low — empty state offers no self-service | No way for a child to request/flag a missing item themselves | A single "ask my parent to add this" button that actually notifies the organizer, once real multi-user exists (Journey 5) |
| Home dashboard (elderly mode) | L1 inform | Moderate, undercut by mislabeled tiles | "Call Insurance"/"Call Son" aren't calls | Rename honestly today ("View insurance"/"View Son") until a real phone field and `tel:` link exist |
| Family / Member / Asset detail | L1 inform | Moderate — mostly read-through | "Investments" and "Pension" are the same component under different labels | Either merge the labels honestly or build the data distinction — don't leave a distinction implied but not real |
| Inbox | L2 recommend | Real when live, clearly labeled otherwise | None significant — the best-executed live/sample split in the app | Extend the same honest live/sample pattern used here to the Assistant (Journey 3) |
| Settings | L0–L1 (user does everything, correctly — this is a config surface) | N/A — utility journey | Sign-out routes to `/welcome` rather than `/login`, a small inconsistency for a returning user | None needed — this journey is appropriately unambitious |
| Upgrade / Keel Plus | L1 inform | Direct business value; honest free/paid boundary | No auto-poll after Stripe `?success=true` — manual refresh required | Poll subscription status for ~30s after return, auto-clear the banner the moment it's actually active |
| Support | L0 (should be — currently isn't even functional) | Currently negative — erodes trust rather than building it | Placeholder email address; no real deletion/export endpoint exists at all | Not a 10x problem — a floor problem: make the existing promise true before anything more ambitious |
| Family Map | L1 inform | Low-moderate — a navigation aid, not a decision tool | None significant — correctly scoped as view/navigate-only | Surface a detector-flagged gap directly on the graph (e.g. a highlighted node for "no life insurance for primary earner") — turn the map into a second lens on the same insights, not just a prettier nav |
| Public readiness quiz | L2 recommend | High as a growth loop, disconnected from in-app value | Naming collision with the in-app "readiness score" — same words, different metric | Let a logged-in user retake the same quiz from inside the app, or at minimum reconcile the two scores into one story |

## Cross-journey synthesis

### Must / Should / Could / Not Needed

**Must have (blocks the core promise or the core safety rule):**
- Fix Emergency Mode routing so every crisis tile leads to a real, tracked report (Journey 1)
- Close the trust-tier documentation/code gap — gate or remove the live `action-executor.ts` dispatch code before any frontend can reach it unguarded (Journey 2)
- Fix the Assistant's live/error ambiguity and wire up error reporting (Journey 3)
- Make the support page's contact path real, and get a real answer on account-deletion/export capability (flagged across the acceptance-criteria doc)

**Should have (materially improves trust or activation, not safety-blocking):**
- One-step document-to-insight flow in the Financial Profile loop (Journey 4)
- A real, minimal family invite-acceptance flow (Journey 5) — large but foundational
- Onboarding continuity through the collision dead end, and chat-to-wizard context carryover (Journey 6)
- Sync life-event checklist progress to the backend, or disclose that it's device-local (Journey 1)

**Could have (real value, not urgent):**
- Auto-poll after Stripe checkout return
- Honest tile relabeling in elderly mode ("View" not "Call") as a stopgap before a real phone field exists
- Retake-the-readiness-quiz-in-app / reconcile the two "readiness" concepts
- Surface detector gaps directly on the Family Map

**Not needed right now:**
- Any push toward Autonomy Ladder Level 5+ anywhere in the product — no journey reviewed here has earned it, and the roadmap's own sequencing agrees
- New domains (health, physical assets, travel/context) ahead of fixing what's already live in the financial domain — consistent with the roadmap's own "deepen before widening" instinct
- The orphaned Studio/admin backend, audit-log viewer, case-studies, and blog-authoring surfaces — not urgent, but worth an explicit decide-and-document rather than silent accumulation

### Where the product is genuinely differentiated

The honest live/sample distinction, applied consistently in Inbox and (once fixed) the Assistant, is a real, hard-to-copy differentiator if kept disciplined — most AI products default to confident-sounding output; Keel's instinct to say "this is a sample" is the harder, more trustworthy choice, and it's mostly already built. The Tier 1 "prepare, don't send" pattern, applied consistently across insights and life-event steps, is the other real one — it's a genuine trust architecture, not just a feature, and it's rare enough to be worth defending explicitly rather than eroding it by rushing toward Tier 2 before the gate exists.

### Where the product is currently just a feature collection

Family sharing (Journey 5) is the clearest case: an invite code with nothing behind it is not a family feature, it's the appearance of one. Similarly, six domains named in the vision with two actually built is fine as an honest work-in-progress, but several UI surfaces (the "Health" naming on financial sub-scores, the readiness-quiz naming collision) borrow vision-level language for features that don't yet deliver the vision-level thing — worth an explicit pass to make sure naming never runs ahead of capability.

### The single highest-leverage move

If only one thing from this entire review gets prioritized: **close the gap between `action-executor.ts` and `ARCHITECTURE.md`'s claim that no autonomous Act exists.** Every other finding here is a UX or trust problem; this one is the specific thing CLAUDE.md was written to prevent, already sitting in the codebase, one missing screen away from being reachable. Fixing Emergency Mode is the most user-visible must-have; fixing this one is the most consequential.
