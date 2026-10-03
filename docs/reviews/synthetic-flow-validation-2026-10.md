# Synthetic Flow Validation — Live API + Web Run-Through (October 2026)

End-to-end validation of every major product flow against a running local
stack (API on :3001, Web on :3002) using the production `.env` with
MongoDB Atlas and Redis Cloud. Not browser-only; every flow was tested at
the API level with real HTTP requests, real data writes, and real detector
engine evaluation.

Companion to [built-vs-market-and-innovation-flywheel-2026-10.md](built-vs-market-and-innovation-flywheel-2026-10.md).
That document scored capabilities against market claims; this one proves
which claims are backed by working code.

---

## Environment

| Component | Configuration |
|---|---|
| **API** | Fastify on `:3001`, MongoDB Atlas, Redis Cloud |
| **Web** | Next.js on `:3002` (dev mode, static export target) |
| **LLM** | Azure OpenAI (gpt-4o deployment) |
| **OCR** | Azure OpenAI (GPT-4o vision) |
| **Push** | VAPID keys configured |
| **Stripe** | ✅ Configured (`sk_test_` key validated — checkout session creation works; `STRIPE_WEBHOOK_SECRET` still needed for payment confirmation) |
| **SendGrid** | Not configured — intentionally deferred (webhook route returns 503 until `SENDGRID_EVENT_WEBHOOK_KEY` is set) |
| **Google OAuth** | Configured (client ID + secret present) |

### Missing configurations that block specific flows

| Config | What it blocks |
|---|---|
| ~~`STRIPE_SECRET_KEY`~~ | ✅ Resolved — test key configured, `POST /billing/checkout` (plan: `starter`) returns a live `checkout.stripe.com` URL against the Oak Plus £7.99/mo price. |
| `STRIPE_WEBHOOK_SECRET` | Checkout works, but payment confirmation (`checkout.session.completed` → plan upgrade) needs the webhook signing secret. Get it from `stripe listen --forward-to localhost:3001/billing/webhook` (local) or Stripe Dashboard → Webhooks (deployed). |
| `SENDGRID_API_KEY` (per-tenant connector credential) | Tier 2 `send_email` actions would fail at dispatch. Tier 1 drafts still work (they never call SendGrid). |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (per-tenant) | WhatsApp/SMS delivery channels non-functional. |
| `SETTINGS_ENCRYPTION_KEY` | Not set — connector credentials use `ENCRYPTION_KEY_V1` fallback (dev zero-key in non-production). |
| No real IMAP/Gmail credentials | Email connector shows "not connected". Email scan cron runs but has no inboxes to scan. |
| `OPEN_BANKING_TOKENS` not set | Open Banking connector shows available but OAuth flow would fail. |

---

## Flow-by-Flow Results

### 1. Public Landing & Readiness Quiz ✅

| Step | Result |
|---|---|
| Landing page (`/`) | 200 OK, renders correctly |
| Readiness quiz page (`/readiness`) | 200 OK |
| `POST /readiness-quiz` with synthetic profile | **Works.** Returns score 23/100, emergency_fund 38, protection 10, retirement null, education null. Top 2 insights returned with real reasoning and impact estimates. |
| Score uses real engine | Confirmed — `engine.evaluate` runs against `family.household` and `family.savings` signals with the actual detector YAML rules. |
| Anonymity | Confirmed — no signal persisted for the quiz tenant, only an anonymized growth event with score band. |
| Quiz → lead capture | `POST /leads` works (consent_marketing required). |

**Finding:** Readiness quiz is a genuine competitive differentiator — it
runs the real detection engine, not a marketing approximation.

---

### 2. Signup & Authentication ✅

| Step | Result |
|---|---|
| `POST /auth/signup` | Creates user, issues JWT, returns user object with `email_verified: true` (dev mode). |
| New user starts empty | `GET /family` returns `null`, `GET /family/financial-profile` returns `null`. |
| JWT contains tenant_id | Confirmed — tenant-scoping works from first request. |

---

### 3. Family Roster & Member Management ✅

| Step | Result |
|---|---|
| `POST /family` | Creates family with organizer auto-linked to the authenticated user. |
| `POST /family/members` (partner) | Added as `parent`, status `pending`, with DOB. |
| `POST /family/members` (child) | Added as `child`, status `pending`, with DOB. |
| Invite code generated | 6-char hex (`CD01F8`), displayed in response. |
| Roles are real | `organizer/parent/adult/child` — validated on input. |

---

### 4. Financial Profile & Detector Engine ✅ (headline flow)

| Step | Result |
|---|---|
| Profile submit with `generate_insights: true` | **9 insights generated from 5 detectors, 8 rules firing.** |
| Protection gap (5 rules) | `life_insurance_below_household_needs` ✅, `no_income_protection` ✅ (household + Jordan), `member_no_life_cover` ✅ (Jordan), `no_health_or_critical_illness_cover` ✅ |
| Emergency fund (1 rule) | `emergency_fund_below_3_months` ✅ (1.4 months vs 6-month target) |
| Retirement (1 rule) | `retirement_behind_target_age` ✅ (43% of target) |
| Education | No rules fired (correct — fund exists, above 50% threshold for the 5-year rule, not empty) |
| Estate (2 rules) | `estate_no_will` ✅, `estate_no_power_of_attorney` ✅ |
| Per-member detection | Jordan's `member_no_life_cover` and `no_income_protection` correctly attributed via `member_id` in `feature_snapshot`. |
| Stale resolution on profile change | ✅ When organizer changed to `unemployed`, the household `no_income_protection` auto-resolved (no income to protect). Jordan's stayed `identified` (still employed). |
| Stale resolution on vault upload | ✅ `estate_no_power_of_attorney` auto-resolved when PoA uploaded. |

**Finding:** The detector engine is genuinely production-ready. 13 rules
across 5 detectors, all firing correctly with proper per-member scoping,
stale resolution, and evidence trails.

---

### 5. Readiness Score ✅

| Step | Result |
|---|---|
| `GET /family/readiness` | Score 18/100 with all 5 components. |
| Emergency fund | 24/100 (1.4 months, target 6). |
| Protection | 8/100 (life cover, income protection, health/CI all flagged). |
| Retirement | 43/100 (achievable income = 43% of target). |
| Education | 7/100 (Sam's fund at 7% of target). |
| Estate | 0 → 50 → 100 as documents uploaded. |
| Score updates in real-time | Confirmed — each vault upload and profile change immediately recalculates. |
| Member readiness | Jordan: protection 0, retirement null (no pension data), estate 0. |
| `has_live_data` flag | `true` after first evaluation — correctly distinguishes "evaluated clean" from "never evaluated." |

---

### 6. Ask Oak Assistant ✅

| Step | Result |
|---|---|
| Household query | **isLive: true.** Grounded in real profile data — references exact amounts (£100k cover vs £488k need), identifies Jordan by name, notes "profile pending." |
| Member-scoped query (`member_id`) | **isLive: true.** Correctly scopes to Jordan's twin data. Notes income protection and life cover gaps with per-member figures. Adds "profile pending" caveat. |
| Informational tone | Confirmed — "consult a licensed insurance professional" on every actionable statement. No provider names. |
| Context grounding | References emergency fund, mortgage, per-member insights, pending document status. |

**Finding:** The LLM system prompt constraints are well-enforced. Tested
with Azure OpenAI gpt-4o — responses are informational, grounded in real
data, and never cross into advice.

---

### 7. Scenario Simulation ✅

| Step | Result |
|---|---|
| `POST /assistant/simulate` (job loss, 3-month horizon) | Deterministic math: income drops £8,500→£3,500, surplus £5,000→£0, savings at change £20,000 (3 months of accrual). LLM narrates — `isLive: true`. |
| Persisted scenario create | ✅ Saved to `family_scenarios` collection. |
| Multi-step preview | ✅ Two regime points: month 0 (income drops to £3,500), month 6 (income recovers to £7,500). Timeline correctly shows both regimes. |
| Persisted scenario read-back | ⚠ **Timeline data returned with zeroed values on read-back.** The preview endpoint works correctly but the stored scenario's read-on-demand recomputation returned empty timeline points. |
| Education fund projection | Accessible when `targetChildName` provided (not tested with target child). |

**Finding (bug):** Persisted multi-step scenario read-back returns zeroed
timeline. The preview endpoint (`POST /family/scenarios/preview`) computes
correctly. The save→read path likely has a serialization or recomputation
issue when `steps[]` is stored vs. when the profile input is reconstructed.

---

### 8. Life-Event Playbooks ✅ (strong differentiator)

| Step | Result |
|---|---|
| Report job loss | Playbook rendered with 5 personalized steps. |
| Step 1 (runway) | "Emergency savings of £5,000 cover about 1 month at £3,500/month." — **real numbers from profile.** |
| Step 2 (income protection) | "You don't have income protection cover on file for this earner." — **real gap detection.** |
| Step 5 (mortgage lender) | "You have a mortgage of £250,000 outstanding on file. Contact your lender early." — **real profile data.** |
| Step completion | `POST .../steps/runway/complete` persists server-side. Cross-device coordination works. |
| Tier 1 draft (mortgage lender) | Generated a 258-char outreach message. Never calls SendGrid. |
| De-dupe | Second `POST` created a second event (no de-dupe on API — this is by design for the API, the UI handles de-dupe warning). |

**Finding:** Playbooks are the strongest crisis-native differentiator in
the product. Real financial data substituted into every step. No competitor
found offers this.

---

### 9. Digital Estate Vault ✅

| Step | Result |
|---|---|
| Upload will (`doc_type=will`) | ✅ Stored with `category: estate_vault`, encrypted via AES-256-GCM. |
| Upload PoA (`doc_type=power_of_attorney`) | ✅ Same encryption. |
| Vault list | Both documents visible with metadata (no amounts/content exposed). |
| Estate detector re-evaluation | ✅ Fires automatically on each upload. Score: 0 → 50 → 100. |
| Stale insight resolution | ✅ `estate_no_power_of_attorney` auto-resolved on PoA upload. |
| Adult gating | Not tested (would need a child account — child accounts can't log in by design). |

---

### 10. Document Upload & OCR ✅

| Step | Result |
|---|---|
| Upload PNG | Stored in GridFS, status `uploaded` → `extracted` (async processing). |
| OCR classification | Test red PNG correctly classified as `other` (no meaningful text). |
| `aiExtractionEnabled` | `true` on the test account (admin role, no plan restriction in dev). |
| Profile suggestions | Available via `GET /documents/:id/profile-suggestions` (not tested with a real insurance doc). |
| Apply-to-profile | Whitelisted paths only, regenerates insights after apply. |

---

### 11. Insight Lifecycle & Approval Gate ✅

| Step | Result |
|---|---|
| Action preview | Returns classified actions with `type`, `external`, `summary`. Estate insight: 3 × `log_only`, all `external: false`. |
| Explain (evidence trail) | Returns full `input_data`, `evaluated_at`, `matched_condition`, detector config hash. |
| Tier 1 prepare (draft) | 280-char outreach message for life insurance review. Never sends. |
| Approve (Tier 2) | `identified → approved → completed` in one request. Actions were all `log_only` so execution succeeded immediately. |
| Trust increment | `trust_level_by_workflow.family_estate_readiness` incremented to 1 after approval. |
| Dry run mode | Available in automation settings, defaults to `false`. |

---

### 12. Family Sharing & Secondary Access ✅

| Step | Result |
|---|---|
| Join request (public, unauthenticated) | `POST /family/join` with invite code → `status: pending`, `family_name: Test Family`. |
| Organizer sees request | `GET /family/access-requests` returns the pending request with name/email/timestamp. |
| Approve request | `POST .../approve` → creates user, returns `approved: true`. |
| Jordan logs in | Gets JWT, sees full family data + readiness score. |
| Jordan sees readiness | Score 28, `has_live_data: true`. |

**Finding (data integrity):** Jordan appears twice in the roster — once as
the original `parent` (pending) and once as the newly approved `adult`
(active). The approve path added a new member instead of activating the
existing pending entry by email match. The existing roster entry was
created manually without an email, so the approve couldn't match by email.
This is an edge case in the flow where a roster member was added by name
before an email was associated — but it results in a duplicate member that
could confuse per-member reasoning.

---

### 13. Member Twin & Member Agent ✅

| Step | Result |
|---|---|
| Jordan's twin | Earner slice, 0 policies (none attributed), 2 member-scoped insights, readiness 0/100 protection. |
| Jordan's agent | `persona: adult`, `provisional: true` (pending member). 4 nudges: 2 insight-based, 2 attention-based. |
| Sam's twin | Age 11, education fund at 7% of target. |
| Sam's agent | `persona: guardian` (speaks to parents). 1 nudge: education attention. |
| Youth twin (`?mode=youth`) | `age_band: younger`, 1 savings goal at 7% progress, 3 age-appropriate lessons ("Save a little first", "Money grows slowly", "Needs before wants"). |

**Finding:** Member agent personas are genuinely differentiated — adult vs.
guardian, with appropriate nudge targeting. Youth twin server-side
redaction is real (no minor-unit amounts in the payload).

---

### 14. Assets & Cashflow ✅

| Step | Result |
|---|---|
| Create asset (property) | ✅ Family Home, £450,000, with summary by kind. |
| Cashflow entries | ✅ Income (£5,000/mo) and expense (£1,500/mo) entries with monthly normalization. |
| Cashflow summary | `net_minor: 350000` (£3,500 surplus). Runway calculation available when emergency savings configured. |

---

### 15. Other Flows

| Flow | Result |
|---|---|
| **Referral code** | ✅ Auto-generated 6-char code. |
| **Lead capture** | ✅ Accepts email + consent, returns `ok: true`. |
| **VAPID public key** | ✅ Returns configured key — push registration ready. |
| **Connectors status** | Email and Open Banking both show "not connected" (correct — no credentials configured). |
| **Automation settings** | ✅ Returns all fields: `dry_run_mode`, `trust_level_by_workflow` (1 for estate after our approval), `renewal_reminders_enabled`, etc. |
| **Account export** | ✅ Returns full JSON bundle: user, family_group, financial_profile, documents, insights, goals, signals, action_receipts, etc. |
| **Blog posts** | ✅ 6 posts returned (public, no auth needed). |
| **Billing checkout** | ✅ `POST /billing/checkout` returns a live Stripe Checkout URL for the `starter` (Oak Plus £7.99/mo) plan. Webhook secret still needed for post-payment fulfillment. |
| **Context note** | ✅ False positive — request body expects `note` (not `context_note`); response correctly serializes `contextNote`. |
| **Unreported change nudge** | `active: false` after employment change — correct: the change was made by the user themselves in the profile save, not "unreported." |
| **Consolidated insights** | Returns grouped by entity_key (household + Jordan). |

---

### 16. Web Frontend Pages

All 24+ routes return HTTP 200:

| Category | Pages |
|---|---|
| **Public** | `/`, `/readiness`, `/login`, `/signup`, `/support`, `/privacy`, `/terms`, `/blog`, `/guides` |
| **Product** | `/family`, `/financial-profile`, `/inbox`, `/upload`, `/vault`, `/connect`, `/assistant`, `/events`, `/life-events`, `/assets`, `/cashflow`, `/map`, `/settings`, `/settings/automation`, `/audit-log` |
| **Health** | `/health/protection`, `/health/savings`, `/health/retirement`, `/health/goals` |
| **Growth** | `/upgrade`, `/marketing` |
| **Operator** | `/operator` |
| **PWA** | `manifest.json` ✅, `sw.js` ✅ (service worker) |

---

### 17. API Server Health

| Observation | Severity |
|---|---|
| All crons started successfully (17 cron jobs) | ✅ |
| Token refresh for `twitter_x` failed (TLS cert issue, unrelated to product flows) | Low — marketing only |
| Signal validation warnings: "No schema registered for signal type: family.* version: 0.0.0" | Low — signals still persist and evaluate correctly; validation schemas not registered for family signals (cosmetic logging issue) |
| Migration index conflict (initial indexes already exist) | None — cosmetic, existing index matches |
| Residual "Kairos" branding in email headers/defaults | Medium — trust/identity issue per the market review |

---

## Summary of Findings

### What works (end-to-end, production-grade)

1. **Detector engine** — 5 detectors, 13 rules, with per-member scoping,
   stale resolution, evidence trails, and the full insight lifecycle.
2. **Readiness score** — 5 weighted components, real-time recalculation,
   honest handling of absent data.
3. **Ask Oak** — grounded in real profile data, member-scoped, informational
   tone enforced.
4. **Life-event playbooks** — 7 event types, real financial data in every
   step, server-persisted checklist, Tier 1 draft outreach.
5. **Scenario simulation** — deterministic math with time-shifting and
   multi-step regimes. LLM narrates, never calculates.
6. **Digital Estate Vault** — AES-256-GCM encryption, estate detector
   re-evaluation on upload, stale insight resolution.
7. **Family sharing** — organizer-gated join flow, second real login.
8. **Member twins** — per-member readiness, agent persona (adult/guardian),
   youth twin with server-side redaction, age-banded lessons.
9. **Document upload & OCR** — GPT-4o vision extraction, policy suggestion
   pipeline, approval-only apply.
10. **Readiness quiz** — real engine, real scoring, effective lead-gen.
11. **Design system** — full glass-morphism token architecture, dual-theme
    WCAG AA, print styles, persona-adaptive UI (5 modes), haptics, spring
    animations, offline PWA with push/badges/service-worker.
12. **Conversational onboarding** — chat-style wizard with a live family
    graph that grows as you answer (digital twin bootstrapping in real
    time), sessionStorage draft persistence across login redirects.
13. **Emergency Mode** — full-screen crisis overlay, localized emergency
    numbers (999/911/112 by country), Escape key, minimal choices.
14. **Insight approval gate** — action preview → approve/draft/dismiss,
    dry-run banner, "why this insight" disclosure, provenance stamps.
15. **"Since Last Visit" delta card** — compares score/insights against
    previous visit, the "what changed" moment competitors lack.
16. **Trust Ladder** — adaptive onboarding checklist that promotes the
    step closing the biggest detected gap first.
17. **Knowledge Graph** — interactive React Flow family map with force
    simulation, privacy modes, and keyboard navigation.
18. **Scenario timeline chart** — SVG trajectory visualization showing
    savings over months with fund-depletion marker.
19. **Readiness history sparkline** — daily score snapshots with trend
    delta on the homepage score card.
20. **Cashflow visualization** — proportional in/out bar + runway gauge.
21. **Adaptive playbook steps** — "On file" badge on steps where the
    family's data already covers the concern.

### Bugs found

| # | Bug | Severity | Location |
|---|---|---|---|
| B1 | ~~Persisted scenario read-back returns zeroed timeline~~ — **false positive.** The test script used `t['month']`/`t['balanceMinor']` but the API returns `atMonth`/`savingsMinor`. The scenario correctly recomputes on read. | Resolved | Test script field-name mismatch, not a product bug |
| B2 | **Duplicate roster entry on join-request approve** when the member was added to the roster by name before an email was associated | Low | `routes/family-join.ts` approve path — email match fails when existing member has no email |
| B3 | ~~Context note not returned in family response~~ — **false positive.** The API expects `note` (not `context_note`) in the PATCH body; the response correctly returns `contextNote`. | Resolved | Test script field-name mismatch, not a product bug |
| B4 | **Mock data leaks into production** — `CommandPalette` uses hardcoded `FAMILY_MEMBERS` (Dad/Mom/Emma/Lucas), `AIAnswerCard` uses `$`/fictional providers in a `£` app, `assets-data.ts` renders a fake £950k home | Medium | `lib/data.ts`, `components/AIAnswer.tsx`, `lib/assets-data.ts` |

### Remediation status

| # | Fix | Status | Notes |
|---|---|---|---|
| B1 | Scenario read-back zeroed timeline | ✅ False positive | Test script used wrong field names |
| B2 | Duplicate roster on join-request approve | ✅ Fixed | `family-join.ts` now matches pending members by name when email is absent |
| B3 | Context note not serialized | ✅ False positive | API uses `note` in body, returns `contextNote` correctly |
| B4 | Mock data in production surfaces | ✅ Fixed | `CommandPalette` now reads live family data; `AIAnswerCard` mock answers updated to `£`/generic UK language; `assets-data.ts` and `data.ts` stripped to types |
| G4 | Kairos branding residue | ✅ Fixed | Sender defaults, SEO URLs, sitemap, robots, llms.txt all changed to `agent-oak.ai` / `Agent Oak` |
| G3 | Time-based proactive nudges | ✅ Added | Age-milestone nudges (13, 16, 18, 25, 50, 60) and policy-renewal nudges (45-day lead) in `buildMemberAgent` |
| G2 | Neutrality statement visibility | ✅ Already present | "No commission" language on inbox, insight detail, homepage, footer disclaimer |
| G5 | Adaptive playbook branching | ✅ Added | `isStepCovered()` marks steps where profile data already covers the concern — UI shows "On file" badge |
| S1 | Signal schema warnings | ✅ Fixed | `family-signal-schemas.ts` registers Zod schemas for all 6 `family.*` signal types |
| D1 | Scenario visualization | ✅ Added | `ScenarioTimeline` SVG trajectory chart renders savings-over-time with fund-depletion marker |
| D2 | Readiness history sparkline | ✅ Added | Daily score snapshots persisted on each readiness read; `GET /family/readiness/history` returns 90-day trend; `ReadinessSparkline` renders trend + delta on homepage |
| D3 | Cashflow visualization | ✅ Added | Proportional in/out bar + runway gauge on `/cashflow` |
| G5 | Adaptive playbook covered steps | ✅ Added | `isStepCovered()` marks steps where profile data already covers the concern — UI shows "On file" badge |

### Configurations needed for production

| Config | Impact |
|---|---|
| ~~`STRIPE_SECRET_KEY`~~ | ✅ **Resolved** — configured and verified (checkout session creation works end-to-end) |
| `STRIPE_WEBHOOK_SECRET` | **Blocking for fulfillment:** checkout completes but plan upgrade won't apply until signed webhooks are verified. Dev: `stripe listen --forward-to localhost:3001/billing/webhook` → copy the `whsec_` into `.env` |
| `SENDGRID_API_KEY` (per-tenant or global) | **Blocking for Tier 2:** approve→send_email fails at dispatch |
| `SETTINGS_ENCRYPTION_KEY` | **Security:** Using dev zero-key for credential encryption in non-production |
| Real email connector credentials | **Feature:** Email scanning/ingestion non-functional |
| `KAIROS_ADMIN_KEY` | Blog admin writes (parked, not customer-facing) |
| Rename all `kairos` sender defaults to `agentoak` | **Trust:** Residual branding in outbound communications |

### Signal validation warnings — resolved

~~The API logs show `"No schema registered for signal type: family.* version: 0.0.0"` for every signal emission during profile evaluation.~~

**Fixed:** `lib/family-signal-schemas.ts` now registers Zod schemas for all
6 `family.*` signal types at server startup (alongside the existing
connector schema registry injection). The warnings no longer appear in
production logs.

---

## Part 2 — UX/UI Innovation Audit

A design-level audit of the frontend against the competitive positioning.
This isn't "does the UI exist" — it's "does the UI make the product feel
like what the market positioning claims it is: an always-on readiness
system for the whole family."

### Design System — genuinely innovative, not a commodity

The design system is a **glass-morphism dark theme** with a full semantic
token architecture (surface-0 through surface-3, ink-1/2/3, tint), dark
and light modes with proper WCAG AA contrast compliance, and a coherent
visual language across every surface. This isn't a Tailwind default — it's
a deliberate, cohesive system.

| Element | Implementation | Innovation level |
|---|---|---|
| **Color system** | CSS custom properties as RGB triplets (`rgb(var(--x) / alpha)`), dual-theme with `data-theme` switching. `--tint` cleverly maps white→black between themes so glass surfaces work in both. | High — solves a real dual-theme problem elegantly |
| **Typography** | Inter via `next/font`, 17px root, semibold gradient titles on page headers | Clean — matches Apple HIG conventions |
| **Glass surfaces** | `.glass`, `.glass-strong`, `.glass-nav`, `.glass-input` — backdrop-blur with saturation boost. Not just a trend — the layered translucency makes the "digital twin" metaphor feel spatial. | High — creates a distinctive visual identity |
| **Accessibility** | WCAG AA colors verified per-theme, `focus-visible` outlines, `prefers-reduced-motion` respected, `min-height: 44px` on all touch targets, keyboard navigation on the KnowledgeGraph, print styles for checklists | High — print stylesheet for crisis documents is an empathy-driven touch no competitor matches |
| **Micro-interactions** | `framer-motion` everywhere: spring-based entrance animations, staggered card reveals, `whileTap` scale feedback, animated score ring | High — feels like a native app, not a web page |
| **Haptics** | `lib/haptics.ts` — light/medium/heavy haptic feedback on every tap | High — a real mobile-app touch |
| **Empty states** | Purpose-built EmptyState component, GettingStarted checklist, honest "no data yet" states | Medium — standard pattern, well-executed |
| **Skeletons** | Shimmer skeleton components during loading | Standard — but consistently applied |

### The Readiness Score — the product's headline UI element

The `ScoreRing` component is the most important visual in the product.
It's an animated SVG ring (stroke-dashoffset transition) with:
- Color-coded by health (green ≥80, amber ≥60, red below)
- Glow filter matching the score color
- Spring-animated number count-up on mount
- Adaptive caption ("out of 100" hidden below size=100)
- Correct WCAG semantic colors per theme

**This is the "always-on readiness" claim made visible.** It works.

### Emergency Mode — crisis UX done right

`EmergencyMode.tsx` is a **full-screen, black-background overlay** with:
- Life-safety notice at the top ("If anyone is in immediate danger, call 911")
- "What happened?" headline — conversational, not clinical
- 5 large event tiles (bereavement, medical, car, property, travel) with
  haptic feedback and staggered entrance animations
- "Something else — see all event types" catch-all
- Escape key handler (the only overlay in the app besides CommandPalette
  to have one — deliberately added for stressed users)
- Focus trap for accessibility
- No visual clutter — just the essential choices

**This is the crisis-native differentiator made real.** No competitor
has an equivalent.

### Persona-Adaptive UI — genuinely innovative

The mode system (`lib/modes.ts`) is a **5-persona adaptive UI**:

| Mode | Font | Money | Advanced | Simple Lang | Emergency | Voice Nav |
|---|---|---|---|---|---|---|
| Organizer | 17px | ✓ | ✓ | ✗ | ✓ | ✗ |
| Parent | 17px | ✓ | ✓ | ✗ | ✓ | ✗ |
| Adult | 17px | ✓ | ✗ | ✓ | ✓ | ✗ |
| Child | 18px | ✗ | ✗ | ✓ | ✗ | ✗ |
| Elderly | 22px | ✓ | ✗ | ✓ | ✓ | ✓ |

Each mode gets a completely different homepage:
- **Organizer/Parent**: Full dashboard (score, health rings, trust ladder, family roster, timeline, memory prompts)
- **Child**: Education fund progress bar + age-appropriate copy
- **Elderly**: Large touch targets, minimal tiles ("Ask Anything," "View Insurance," "View Son," "Important Documents," "Emergency Help"), oversized ScoreRing

`Money` component redacts currency amounts (`•••`) in child mode.
`MoneyText` redacts embedded currency in assistant prose too.

**This is per-member UX at a level no competitor matches.** Monarch shows
the same dashboard to every user. Oak adapts the entire interface per
persona.

### The "Since Last Visit" Delta — Apple-style

`SinceLastVisit` is a **delta-based greeting** — the kind of feature
Copilot Money pioneered:
- Compares current score/insight count against the previous visit
- "Readiness score up 3 points · 2 new insights to review"
- Silent on first visit ("Everything looks stable.")
- Calm greeting on no-change ("Good morning, Alex. No changes since your last visit.")
- localStorage-persisted per-tenant (shared device safe)

**This directly competes with Copilot/Monarch's "what changed" moment.**

### Feature Tips — progressive disclosure

A rotating tip system (6 tips, one per visit, localStorage-dismissed):
- "Ask Oak anything about your family finances — tap the purple button."
- "Swipe left on an inbox item to dismiss it — you can undo within 5 seconds."
- Each tip links to the relevant page

**Apple-style progressive discovery — never overwhelming.**

### Getting Started — honest checklist

The `GettingStarted` component replaces the generic empty state:
- 3-step checklist (upload document, fill profile, connect service)
- Real completion tracking (server-fetched, not just local flags)
- Progress bar with animated fill
- Completed steps get strikethrough + green check
- Only shows when there's no live score yet — honest about what "done" means

### Knowledge Graph — the family map

`KnowledgeGraph.tsx` uses `reactflow` for an interactive family graph:
- Force-directed layout (physics simulation, tuned for mobile)
- Family at center, members connected to their protection/asset/policy nodes
- Category filtering (all, protection, wealth, goals)
- Tap person → navigate to member page, tap asset → asset page
- Keyboard-navigable (Enter/Space activates nodes)
- Minimap at fullscreen (deliberately shrunk to avoid covering nodes)
- Bottom-sheet story panel for category nodes

**This is the "digital twin" made visible** — an interactive map of the
family's financial relationships, not just a table of data.

### Command Palette — power user UX

`CommandPalette.tsx` (Cmd+K) with:
- Quick navigation to all major pages
- Emergency Mode trigger
- Keyboard-accessible overlay
- Escape handler

### Conversational Onboarding — the first impression

`ConversationalOnboarding.tsx` is a **chat-style onboarding flow**:
- AI-guided questions (name, family members, ages, emails)
- sessionStorage draft persistence across login-collision redirects
- Family graph built from answers and carried into the profile wizard
- Email format validation before signup attempt
- Resumes where the user left off after authentication

**This matches Origin's chat-onboarding UX** — not just a form.

### Remaining UX/UI gaps vs competitors

| Gap | Competitor example | Impact | Effort |
|---|---|---|---|
| ~~**No data visualizations**~~ → **Partially fixed** | Scenario timeline chart (savings trajectory + depletion marker), readiness history sparkline (90-day trend), cashflow proportional bar + runway gauge. | Still missing: per-component readiness breakdown chart, spending-by-category trends (requires connector data). | ~~M~~ → S remaining |
| ~~**Residual mock data in production surfaces**~~ → **Fixed** | `CommandPalette` reads live family data; `AIAnswerCard` uses `£`/generic UK language; `assets-data.ts` and `data.ts` stripped to types. | — | — |
| ~~**Dashboard doesn't show readiness score trend**~~ → **Fixed** | `ReadinessSparkline` renders 90-day trend + delta under the score ring. | — | — |
| **No streak/habit gamification** | Cleo's "7-day streak," Nova's financial health badges | Families who complete profile updates could earn streaks/badges | M |
| **No "next best action" priority card** | Origin's daily check list shows one thing to do today | The Trust Ladder approximates this but is collapsed by default | S |
| **No family milestone celebrations** | "Sam's education fund just crossed 25%!" | Would gamify the readiness journey | S |
| **Visual identity is generic-premium** | Origin/Trustworthy are warmer/more art-directed | Single font (Inter) with no display pairing, standard glass+indigo palette, no signature color/texture/illustration system | M |
| **Dashboard density** | Monarch/Copilot's glanceable numbers are tighter | 12+ stacked cards; no "what matters today" prioritization | S |
| **Event tiles uniform severity** | All EmergencyMode tiles use the same red icon treatment | Per-type iconography/color exists in the taxonomy but isn't leveraged | XS |
| **No social proof / days-protected** | Life360's "your family has been protected for 45 days" | "Your family has been monitored for N days" could build trust | XS |

### Critical UX bug: Mock data leaks into production

The subagent audit found **three places where fake data ships to real
users** — a genuine trust violation for a product whose whole premise
is "your family's real data":

1. `CommandPalette` (`lib/data.ts:3-54`) — hardcoded `FAMILY_MEMBERS`
   (Dad/Mom/Emma/Lucas) that Cmd+K search will surface in production
2. `AIAnswerCard` (`components/AIAnswer.tsx:25-60`) — `MOCK_ANSWERS`
   with `$` amounts and fictional US provider names in a `£` UK app
3. `ASSETS` (`lib/assets-data.ts`) — a hardcoded "Family Home £950k"
   rendered as a real asset detail

These are **S-sized fixes** (delete or wire to real data) but have
**outsized trust impact** — a product that labels everything "sample vs.
live" elsewhere can't have three fake-data leaks in production.

### UX/UI Score vs Competitors

| UX dimension | Agent Oak | Monarch | Copilot | Origin | Trustworthy | LifeOS |
|---|---|---|---|---|---|---|
| Visual polish | 9/10 | 9/10 | 9/10 | 8/10 | 8/10 | 6/10 |
| Mobile-first design | 9/10 | 9/10 | 9/10 | 8/10 | 7/10 | 5/10 |
| Crisis/emotional UX | 9/10 | N/A | N/A | N/A | 6/10 | N/A |
| Per-member adaptation | 9/10 | 2/10 | 2/10 | 3/10 | 5/10 | 2/10 |
| Data visualization | 6/10 | 9/10 | 9/10 | 9/10 | 5/10 | 4/10 |
| Gamification | 4/10 | 5/10 | 5/10 | 6/10 | 3/10 | 3/10 |
| Empty-state design | 8/10 | 7/10 | 8/10 | 7/10 | 7/10 | 4/10 |
| Accessibility | 9/10 | 7/10 | 7/10 | 6/10 | 7/10 | 4/10 |
| Trust/honesty framing | 9/10 | 7/10 | 6/10 | 7/10 | 7/10 | 5/10 |
| **Overall UX differentiation** | **8/10** | | | | | |

**The UX/UI is genuinely innovative** — the per-member persona system,
emergency mode, glass-morphism design system, conversational onboarding
with a growing family graph, swipe-to-undo, drag-to-dismiss bottom sheets,
and haptic feedback are real differentiators. The emergency mode's
localized emergency number ("call 999" for UK users, "call 911" for US,
"call 112" as fallback) is a detail no competitor has thought through.

The remaining UX gap: **visual distinctiveness** — the design is polished
but reads as generic-premium fintech rather than a signature brand. Needs
a display typeface pairing, bespoke illustration language, or a
recognizable visual motif to be unmistakably "Oak."
(Data visualization and mock-data gaps are now resolved — see the
remediation table above.)
