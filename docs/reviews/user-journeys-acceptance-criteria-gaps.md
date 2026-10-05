# LifeKeel User Journeys — Acceptance Criteria & Gaps

As of 2026-09-18 · reviewed by Claude Code

## Overview

This reviews every user-facing journey in LifeKeel's web app (`apps/web`) against what the backend (`apps/api`) actually supports, based on a full code read of both — not a live-testing pass. Each section lists the journeys in that area as a table: acceptance criteria (what "done" should mean), what's implemented today, and the gap between them. The riskier findings get a short expanded note under their table.

Branch: `main`, with a large amount of in-progress uncommitted work across the app — this reflects the code as currently checked out.

## Acquisition & auth

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Landing page | Every CTA routes a visitor toward signup or login, no dead ends | `MarketingLanding.tsx` — all CTAs route to `/welcome`, `/login`, or footer pages | None found |
| Public readiness quiz | Anonymous visitor gets a real score in under 60s and a path into signup | `/readiness` — 6-field form, real rule engine, native share sheet | `score === null` shows a generic error card with no retry |
| Signup (password or Google) | New user reaches onboarding with a session; failures are recoverable inline | `signup/page.tsx` → `POST /auth/signup` → `/family-setup` | Google path round-trips through `/auth/callback`; an `error` param there shows for 2s then hard-redirects to `/login`, losing the actual error text |
| Login | Returning user with an existing family lands on the dashboard, not onboarding | `login/page.tsx` → `signIn()` also eagerly fetches the family roster | If that fetch transiently fails, the user silently falls through to onboarding again |
| Password reset | Request + confirm flow, no email enumeration, expired/missing tokens handled gracefully | `/reset-password` + `/reset-password/confirm` — generic "check your email" regardless of account existence; missing token shows a dead end with a way to request a new one | None found |
| Welcome carousel | Every slide offers both "get started" and "sign in", skippable | 4-slide carousel | None found |

## Onboarding

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Conversational family-setup | Authenticated user with no family always ends up with a usable family + dashboard access | `ConversationalOnboarding.tsx` — collects organizer + spouse + children, `createFamily()` then best-effort `inviteMember()` per person → redirect to `/` | Two dead ends: (1) unauthenticated path hitting an email collision discards the entire chat session and bounces to `/login` with nothing persisted; (2) any other signup error just stalls the chat, no retry button |
| Recovery email linking (already-authenticated path) | Email collected in chat is linked to the real account | `updateEmail()` called once the account exists | Failure is silently swallowed ("best-effort") — no way for the user to know it wasn't saved |
| Re-entering onboarding | A user who ends up with no family members can get back into setup | `FamilyRoster` empty state links to `/family-setup` | None found |

## Core loop

### Home dashboard

| Persona | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Organizer / parent / adult (default) | Readiness score, life-event and family shortcuts, insight teasers all reflect real account data or are clearly marked sample | Readiness score card (real if data exists, 0-state CTA otherwise), life-event/family/health/timeline cards, retirement teaser | `MemoryPrompts` is explicitly hardcoded sample data — disclosed with a "Sample" label, not hidden |
| Child | Child can see their own progress and act on it | Shows only an education-fund progress card matched by name | No self-service path — empty state just says "ask a parent," no way for the child to request or flag it |
| Elderly | Large one-tap tiles do what they say | 5 tiles: Ask Anything, Call Insurance, Call Son, Documents, Emergency Help | "Call Insurance" / "Call Son" aren't calls — they route to `/financial-profile` and `/family` because no phone-number field exists in the data model. Label promises a different action than it performs |

### Connect accounts / Upload / Financial Profile

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Connect email | Gmail OAuth or manual IMAP connects and enables inbox scanning | `/connect/email` — both paths wired end-to-end to `/inbox` | None found |
| Connect bank (Open Banking) | User can link a bank account | Listed as a connector option | Permanently coded `comingSoon` — "Connect" is blocked outright, only escape hatch is manual entry. A coded dead end, not a bug |
| Upload documents | Any uploaded doc reaches an extracted, usable state or shows why not | Camera/file picker → OCR pipeline polled every 3s → extracted docs open into `/documents/[id]` | Free-tier docs never leave `stored` status and are **not clickable**; upload-failure copy promises offline sync ("will sync when reconnected") with no actual retry mechanism built |
| Apply extracted data to profile | Applying updates the financial profile and regenerates insights in one step | `/documents/[id]` → "Apply to Financial Profile" → success banner | Applying does **not** regenerate insights — user must separately open Financial Profile and save again |
| Financial Profile wizard | Multi-step wizard autosaves, handles concurrent edits safely, generates insights on completion | 4-step wizard, autosave per step with optimistic-concurrency `version` guard, final "Save & Generate Insights" | Autosave failures outside the version-conflict case are silent — no inline indicator a step failed to save |

### Family / member / asset detail

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Family roster | Add/remove/view members, navigate to detail | `/family` — carousel + completion bars (recently fixed from a fake 40/100 split to real binary) | None found |
| Member profile | Per-member financial detail | `/member/[id]` | All financial data is household-level, not per-member — disclosed honestly in copy. Unknown member id links back to `/` instead of `/family` (minor inconsistency) |
| Asset detail (home / investments / pension) | Each asset type shows its own real, distinct data | `/asset/[id]` for 3 ids | "Investments" and "Pension" render the **identical** `RetirementDetail` component — not actually distinguished in the data model, just aliased labels |
| Insurance policies (`policies[]`) | A per-person policy (life, income protection, critical illness, health) is attributable to the family member it actually covers | `family-financial-profile.ts`'s `policies[]` schema: `type, provider, coverage_amount_minor, monthly_premium_minor, renewal_date, policy_number` | See below — **no `member_id` field exists at all**; every policy is a flat, unattributed household-level entry |

### Policy per-member attribution — detailed finding

`policies[]` ([family-financial-profile.ts:113-131](../../apps/api/src/routes/family-financial-profile.ts)) has no field linking a policy to a specific family-roster member — confirmed directly against the schema, which carries `type/provider/coverage_amount_minor/monthly_premium_minor/renewal_date/policy_number` and nothing else. That's a reasonable design for policy types that are genuinely household-wide (car, home), but four of the six recordable types — life, income protection, critical illness, health — are insurance *on a specific person's life or income*. Today, if both parents each hold a separate life policy, they land in one undifferentiated list with no way to tell whose is whose, and no way for a detector or the assistant to answer "is *everyone* covered?" — only "does at least one qualifying policy exist somewhere?"

This is the same shape of gap PRD-104 already fixed once, for a different slice of the same schema: `household.employment_status`/`monthly_salary_minor` used to be single, household-level fields that silently hid a real protection gap in mixed-earner households (KEEL-029) until PRD-104 added `household.members[]` with per-member `employment_status`, `monthly_salary_minor`, and `income_protection_monthly_minor`. Checked PRD-104's own "Out of scope" section directly — it explicitly defers per-member retirement and emergency-fund tracking, but never mentions `policies[]` at all. This isn't a deliberate deferral, it's a gap that slipped through the schema's redesign.

**Ideal acceptance criteria** (the bar this should be held to before it's considered closed):

- `policies[]` gains an optional `member_id`, referencing a real family-roster member (`FamilyMemberUser.id`), following the exact same pattern PRD-104 established for `household.members[]` — additive and optional, so a policy with no `member_id` behaves byte-for-byte as today (a household-wide policy, or one nobody's got round to attributing yet).
- The Financial Profile wizard's "Add a policy" step lets the user pick a family member from the roster for person-scoped types (life, income_protection, critical_illness, health) — and doesn't ask at all for household-wide types (car, home), so the UI doesn't demand an answer that has no correct value.
- A household with two adults on the roster, one holding a life policy and the other holding none, is distinguishable from a household where both are covered — i.e. a new or extended detector rule can correctly answer "is every earner covered?" rather than "does a qualifying policy exist?", the same upgrade PRD-104 delivered for income protection.
- The document-intake bridge (PRD-109's `mapExtractedFieldsToPolicySuggestion` and its review card) carries a member picker too — defaulting to unset, never guessed from OCR content, consistent with PRD-109's "never applied silently" posture — so a scanned policy document doesn't silently become mis-attributed.
- The assistant (PRD-101) can correctly answer a member-specific question ("does my husband have life insurance?") once this exists, the same way PRD-104's own scope note calls out for `assistant.ts`'s grounding context.
- Regression: a household with no `member_id` set on any policy — the entire current dataset — evaluates identically to today; this is additive, not a breaking schema change.
- Regression: car/home policies remain valid with no `member_id`, and the UI never prompts for one on those types.

## Life events & Emergency Mode

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| "What If?" hypothetical scenarios | Explore 10 canned scenarios, get realistic guidance, understand it's exploratory | `/events` → `/events/[eventId]`, personalized when a matching real insight/policy exists, otherwise clearly sample | None found — appropriately labeled as hypothetical |
| Report a real life event | Real event creates a server-tracked record with a personalized playbook, progress shared across the family | `/life-events` → `reportLifeEvent()` → `/life-events/[eventId]` with a real, data-grounded playbook | Checklist step-completion is **localStorage-only** — no backend endpoint exists for it. Two family members coordinating the same real crisis on separate devices each see every step unchecked on the other's device |
| Emergency Mode | A user in a genuine crisis reaches the real reporting flow for their situation, not a generic simulator | Overlay reachable from 3 consistent entry points (Siren button, Cmd+K, elderly tile) | **The most serious gap in this review — see below** |

### Emergency Mode — detailed finding

All 5 crisis tiles in the overlay (bereavement, medical, car, property, travel) route to `/events/[eventId]` — the same hypothetical "What If?" simulator used for casual exploration, with no server record of the event and a generic, non-personalized checklist. Only the visually secondary "This is actually happening" button reaches the real, backend-tracked `/life-events` flow, and it passes through no event id, forcing the user to re-pick from a smaller, differently-labeled 3-item list (job loss / bereavement / disability). Car, property, and travel have **no real-flow equivalent at all** — a user who taps "Car" cannot reach a real report for it no matter which button they choose next. There is no analytics on either path, so there's no way today to measure how often users end up in the wrong one.

**Acceptance criteria this fails**: every emergency tile should either lead to a real, tracked report for that event type, or the overlay should make the hypothetical/real distinction visually unmissable rather than resting on a secondary button.

## AI assistant & inbox

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Ask Keel assistant | Answers use real family data when available, are clearly labeled sample when not, and genuine failures are distinguishable from "no answer available" | `/assistant` — live answers when backend has data; canned answers routed through a second keyword-based live-check with an explicit "Sample answer" disclosure | See detailed finding below |
| Inbox | AI-summarized financial mail when connected, clearly-labeled sample data otherwise | `/inbox` — live if email connected, falls back to sample `INBOX_ITEMS` with a visible banner | None found — correctly split between live dismiss (real API call) and local-only dismiss for sample items |

### Assistant error-masking — detailed finding

`fetchAIResponse` in `apps/web/src/lib/api.ts` is the one call site in that file that skips the app's own `reportError()` convention — a network failure or backend 500 on `/assistant/ask` hits a bare `catch` with no console error and no Sentry event. Worse, `AIAnswerCard` doesn't even use `fetchAIResponse`'s result when falling back — it independently re-queries insights via its own 3-keyword matcher (`retire` / `protected` / `job`). If that independent lookup succeeds, it renders a confident, green-dot "Confidence: based on your documents" card with no indication the original call actually failed. A genuine backend outage on financial guidance can look fully live to the user, and produces zero signal to engineering that it happened.

**Acceptance criteria this fails**: a distinguishable "the assistant is temporarily unavailable" state, and error-reporting parity with the rest of `api.ts`.

## Settings & monetization

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Settings hub | Edit profile, manage family members, switch persona mode, reach connected services / financial profile / upgrade, sign out | `/settings` — all of the above wired to real endpoints | None found |
| Keel Plus upgrade | Clear plan comparison, working checkout, honest handling of return states | `/upgrade` — benefits list, price card, `startLifeKeelPlusCheckout()` redirect, `?success=true` / `?canceled=true` banners | Success banner admits eventual-consistency lag ("refresh if it doesn't update") with no auto-poll — user must manually refresh to see the upgrade take effect |
| Free vs. paid boundary | Consistently and honestly communicated everywhere it applies | Upload, connect, inbox, and upgrade pages all draw the line the same way (extraction / summarization paid, storage / connection free) | None found — one of the more polished aspects of the current build |

## Cross-cutting states

| Journey | Acceptance criteria | Implemented today | Gap |
| --- | --- | --- | --- |
| Route error | Unhandled render error shows a recovery path, not a blank screen | `error.tsx` — generic message + `reset()`, reports to observability | None found |
| 404 | Unknown route shows a way back | `not-found.tsx` → link to Home | None found |
| Offline | User understands they're offline without losing access to cached data | `OfflineBanner` via `useNetworkStatus()` — persistent, non-blocking | None found |
| Support | Billing, security, and data-deletion requests reach a real, working channel | `/support` — sections for account/billing, security reports, data/privacy | See detailed finding below |

### Support page — detailed finding

Every need on `/support` — billing, security vulnerability reports, and data/privacy/deletion requests — funnels to the literal placeholder string `[support@yourdomain.example]`, rendered as inert text, not even a `mailto:` link. This isn't just a missing link: a full read of `apps/api/src/routes/*` turns up **no account-deletion or data-export endpoint anywhere** in the backend. The product's own privacy policy already admits this in fine print ("a self-service 'delete my account' option inside the app doesn't exist yet"). Any real GDPR/CCPA-style data-rights request has no fulfillment path today, on either side of the stack. Separately, once a user is logged in, nothing in Settings links back to `/support` at all — it's only reachable pre-login or by typing the URL directly.

**Acceptance criteria this fails**: a working contact channel at minimum; a real deletion/export endpoint before this is something the business can be held to.

## Missing or orphaned journeys

These are capabilities that exist on one side of the stack but have no corresponding user-facing journey today — not bugs in an existing flow, but journeys that don't exist yet.

| Capability | Backend evidence | Frontend evidence | Status |
| --- | --- | --- | --- |
| Insight approval → autonomous action execution | `POST /insights/:id/approve` triggers real SendGrid email, Twilio WhatsApp, HubSpot CRM tagging via `action-executor.ts` | None — no caller anywhere in `apps/web` | Backend-ready, no frontend (intentional per `ARCHITECTURE.md`: "no autonomous Act exists" today) |
| Dry-run mode / per-workflow trust level | `GET`/`PATCH /settings/automation`, auto-incrementing trust levels on approval | None — the "TrustLadder" component on Home is an unrelated onboarding checklist, not this | Backend-ready, no frontend |
| Family invite acceptance | An invite code is generated and displayed to the user | Nothing redeems it — no `/family/join` endpoint, no `/invite/[code]` page. Backend explicitly documents self-serve signup cannot join an existing tenant | Doesn't exist on either side — "family sharing" today is organizer-adds-roster-entries only, no second real login |
| Studio/admin backend (~15 endpoints: LLM provider config, SSO, detector priority, ML isolation, benchmarks) | `apps/api/src/routes/settings.ts` (970 lines) | None called from `apps/web` | Backend-ready, no frontend — likely leftover from the pre-pivot "LifeKeel" product |
| Audit log viewer | Every security-relevant action logged with a 7-year TTL | No `/audit` route or page anywhere in `apps/web` | Backend-ready, no frontend |
| Case studies (marketing feature) | Submit/approve endpoints exist | No page anywhere | Backend-ready, no frontend |
| Blog authoring | Admin-key-gated create/update/delete endpoints | Only public read (`GET /blog/posts`) is wired | Admin half backend-ready, no frontend |
| Connector backfill / sync status | `POST /connectors/:id/backfill`, `GET /connectors/:id/sync/status` | Not called — only "scan now" and disconnect are wired | Backend-ready, no frontend (may be intentional if backfill auto-triggers server-side) |
| `AIFloatingButton` component | — | Exists in the tree, imported nowhere | Confirmed dead code, superseded by `AskKeelButton` |
| `/support` for logged-in users | — | Page exists, but nothing in Settings links to it once authenticated | Frontend built, unreachable from nav |
| `/readiness` quiz for logged-in users | — | Only linked from the pre-login marketing page; in-app "readiness score" is a different, unrelated metric with the same name | By design, but worth flagging as a naming collision |

## Product vision alignment

Cross-referencing this review against `ARCHITECTURE.md`'s own "where the vision meets reality" table and trust-tier model:

**Family Twin — matches its own stated gap.** The architecture doc says only 2 of 6 vision domains are real (family roster + financial profile); nothing for health, physical assets, travel/context, or preferences. The journeys confirm this on the ground: `/member/[id]` explicitly discloses that all financial data is household-level, not per-member, and `/health/[domain]` is **not** the vision's medical Health domain at all — it's financial-health sub-scores (protection/wealth/goals/savings). **Naming collision worth flagging**: a user or stakeholder skimming the nav sees "Health" and may reasonably expect the vision's actual Health domain, which the roadmap deliberately sequences last, after the trust/consent model is proven elsewhere, because of GDPR special-category sensitivity.

**Family Intelligence — matches.** Vision calls for Understand/Predict; journeys confirm this is real for the financial + protection domains (insights, health-domain drill-down, inbox), consistently and honestly labeled sample where live data doesn't exist yet.

**LifeKeel / trust tiers — the most important misalignment found.** `ARCHITECTURE.md` states "Nothing beyond Tier 1 exists; no autonomous Act" — but the missing-journeys findings above show `action-executor.ts` already contains live Tier 2+ dispatch code: real SendGrid email, Twilio WhatsApp, and HubSpot CRM tagging, reachable via `POST /insights/:id/approve`. No frontend calls that endpoint today, so this isn't user-reachable yet — but the code contradicts the architecture doc's own claim, and CLAUDE.md's rule ("never implement autonomous execution of a financial, legal, medical, or otherwise irreversible action without an explicit human approval gate") has no enforcement point here: there's no approval-gate UI, and no dry-run/trust-level settings screen either. `action-executor.ts`'s own header comment documents that more dangerous action types (Stripe refund/pause, Xero credit notes, social posting) were already deleted once after this same generic-approve pattern let free-text keyword matching trigger them with no per-action confirmation — that lesson doesn't appear to have been applied to the email/WhatsApp/CRM actions that remain.

**Positive finding: one journey is ahead of the documented roadmap.** Roadmap item 3 lists "extend prepare beyond insights (e.g. event-response checklists)" as a *next* step — but the life-events journey review found `prepareLifeEventStepDraft` already shipped and wired into `/life-events/[eventId]`, scoped per checklist step. Worth updating the roadmap doc, or confirming this was intentional early delivery.

**Action Network — matches.** Vision and architecture both describe this as not built yet beyond generic connector plumbing; the Open Banking `comingSoon` dead end is consistent with the roadmap's own sequencing (banks named as the most tractable near-term partnership, not yet started).

**Marketing/growth backend (blog, case studies, growth events) — re-contextualized, not a new gap.** `ARCHITECTURE.md` confirms these are deliberate, named backend surfaces (PRD-201 readiness quiz, PRD-202 detector-driven content). The earlier finding that they have no in-app authoring UI still stands, but this reads as intentional scope (an external CMS/script is the expected caller), not orphaned work — worth a quick confirmation rather than a fix.

**Everything else under "Missing or orphaned journeys" falls outside the vision's four layers entirely** — the Studio/admin backend (LLM config, SSO, detector priority, ML isolation, benchmarks) and the audit-log viewer aren't mentioned anywhere in `ARCHITECTURE.md`. Given the doc's own framing (extracted from a larger "kairos-ai" monorepo, trimmed to what LifeKeel needs), these read as pre-pivot leftovers rather than deferred roadmap items — worth an explicit decide-and-document (delete, or fold into a named future PRD) rather than leaving them live and undocumented.

## Priority recommendations

1. **Fix Emergency Mode routing.** This is the one gap that hits a user at their worst moment — a panicking user taps the labeled tile matching their crisis and lands in a simulator with no record anywhere. Either route all 5 tiles into the real reporting flow with the event type pre-filled, or make the hypothetical/real distinction visually unmissable rather than a secondary button.
2. **Fix or remove the support page's contact path**, and flag the missing account-deletion/export endpoint to whoever owns privacy/compliance — this is a real gap, not a broken link, and the privacy policy already discloses it.
3. **Route `fetchAIResponse` failures through the existing `reportError()` convention.** Cheap fix, removes an operational blind spot where a live assistant outage could run silently with zero alerting.
4. **Sync life-event checklist progress to the backend**, or at minimum tell the user it's device-local — two family members coordinating a real crisis shouldn't each see a blank checklist on the other's phone.
5. **Everything under "Missing or orphaned journeys" reads as intentionally deferred work**, not bugs — worth a deliberate check that nothing in `apps/web` can accidentally reach `POST /insights/:id/approve` before the human-approval UI required by this repo's own trust-tier rule (`CLAUDE.md`) is actually built.
6. **Close the trust-tier documentation gap.** Either strip the live SendGrid/Twilio/HubSpot dispatch code out of `action-executor.ts` until an approval-gate UI exists, or update `ARCHITECTURE.md` to stop claiming "no autonomous Act exists" and treat building that gate as a named, tracked priority — not something that stays true only because no frontend happens to call it yet. Given CLAUDE.md's own rule on this, this arguably belongs above item 1.
