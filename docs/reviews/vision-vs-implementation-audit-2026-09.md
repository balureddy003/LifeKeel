# Vision vs implementation audit — what's actually built (2026-09-28)

A point-in-time inventory of every implemented surface in this repo, mapped
against the multi-agent vision brief (Oak HQ + member twins, crisis
resilience, proactive intelligence, vault, ingestion engine). Produced by a
full read of `apps/api`, `apps/web`, `packages/`, `detectors/`,
`playbooks/`, `verticals/`, and `connectors/` — no live testing.

Companion docs: this is an inventory, not a journey-by-journey review —
see `user-journeys-acceptance-criteria-gaps.md` and
`product-review-council.md` for the UX-level pass, and
`remediation-plan.md` for the earlier gap list (mostly remediated since).

## Headline

**The codebase is ahead of what `ARCHITECTURE.md` used to claim.** A real
Act layer exists (approve→execute, earned-trust auto-execution, opt-in
autonomous reminders), a full notification delivery stack exists
(WhatsApp→SMS→email fallback, push, signed one-click links), deterministic
scenario math exists inside Ask Oak, and there's a 14-page operator
console with billing, lifecycle email, and social publishing. The doc
described "nothing beyond Tier 1"; in fact Tier 2 machinery is wired and
narrow Tier 3 autonomy ships behind explicit opt-ins.

The largest true gaps are the structural ones the vision implies:
**per-member micro-agents** (nothing reasons per-member today), the
**composite server-side Family Readiness Score**, **time-shifted scenario
simulation**, and the **Action Network** (zero live provider
integrations).

## Implemented — by vision pillar

### Family Twin (the data)

| Capability | Where | Notes |
|---|---|---|
| Family roster: organizer/parent/adult/child roles, DOB, invite codes | `routes/family-group.ts` | Real. Members historically were roster records on the organizer's account… |
| Second real login, organizer-approved join flow | `routes/family-join.ts` (PRD-110) | …until PRD-110: a partner can now authenticate independently, gated on organizer approval. "Prepare, don't auto-execute" applied to account access. |
| Financial profile: household income/expenses, emergency fund, retirement, per-child education funds, `policies[]` coverage/renewal | `routes/family-financial-profile.ts` (PRD-102) | Submit → `persistSignal` → `engine.evaluate()` → insights. The load-bearing bridge between data intake and detectors. |
| Digital Estate Vault: encrypted, adult-gated wills/POA storage | `routes/vault.ts` | AES-256-GCM **server-side** (`platform/crypto.ts`), adult-only via `isFamilyAdult`. Explicitly no release/dead-man's-switch logic — see Gaps. |
| Document storage (GridFS) + metadata | `routes/documents.ts` | Storage free on all plans; OCR extraction entitlement-gated (`document_ai_extraction`). |
| GDPR export + immediate delete | `routes/account.ts` | Single JSON export; typed-email confirmation delete. |
| Family Map visualization | `apps/web` `/map`, `KnowledgeGraph.tsx` | Renders the real financial profile + policies, not mock data. |
| Member/asset detail pages | `/member/[id]`, `/asset/[id]` | Client-rendered against the roster/profile — UI seeds of member/asset twins. |

### Family Intelligence (reasoning)

| Capability | Where | Notes |
|---|---|---|
| Deterministic YAML detector engine + evidence chains + confidence calibration | `@agentoak/engine`, `category-table.yaml` | `category-table.yaml` fixes category inference for non-SaaS rule IDs. |
| 4 family detectors: protection gap (incl. `policy_renewal_window`), per-child education shortfall, emergency-fund adequacy, retirement gap | `detectors/family/*.yaml` | Genuine Understand/Predict over real profile signals. |
| Golden eval sets + promotion gate (F1 ≥ 0.80, regression vs baseline) | `detector-evals/*.yaml`, `routes/detector-evals.ts` | `POST /detectors/:id/eval` is a human verdict, never auto-promotes. |
| LLM confidence enrichment, per-tenant opt-in | `llm-scorer.ts` | `llm_scoring_enabled` in tenant_settings; rule-only score otherwise. |
| Alert consolidation (same-entity dedup, secondary factors, explicit "conflicting signal" flag) | `insights/consolidation.ts` (EPIC-001) | Apple Health-style source priority. |
| Full rule-eval trace per insight | `GET /insights/:id/explain` | |
| LLM judge holding insights for human review | `delivery/move-judge.ts`, `/insights/review`, `review-release`, `review-discard` | Organizer can override either way. |
| Life-event playbooks ×7, rendered against live profile | `life-events.ts`, `life-events/render-playbook.ts`, `playbooks/family/*.yaml` (PRD-108) | job_loss, bereavement, disability, medical, car, property, travel. Events are *reported facts*, not inferred — no detector YAML needed. |
| What-If readiness per crisis tile | `GET /family/events/:eventId/readiness`, `life-events/event-readiness.ts` | The `/events` tiles show real numbers before anything is reported. |
| Unreported-life-change nudge | `life-events/detect-unreported-change.ts` (PRD-111) | Detects profile/mailbox drift suggesting an unreported event. |
| Vault-awareness reminder on bereavement/disability/medical | `life-events/vault-reminder.ts` | Email + in-app insight to other adults. Deliberately notification-only — see trust tiers. |
| **Deterministic scenario math** | `POST /assistant/simulate`, `scenarios/calculate.ts` | Income delta → current/projected surplus + runway months; extra savings → per-child fund projection + on-track flag. LLM narrates, never calculates. |
| Readiness score (signed-in) | `fetchFamilyReadinessScore`, `useFamilyData` per-domain scores (protection/wealth/goals/savings), `/health/[domain]` pages | `100 − Σ open confidence × 10`, client-side. Honest empty-state handling (unfinalized profile ≠ 100). **Superseded by PRD-114** — see gap-table row 2. |
| Public readiness quiz | `POST /readiness-quiz` (PRD-201) | Same engine + 2 detectors, unauthenticated, anonymous by design; `/readiness` page + `/leads` opt-in capture. |

### Agent Oak (decide / act / escalate)

| Capability | Where | Tier |
|---|---|---|
| Ask Oak — grounded LLM Q&A over real profile + open insights | `routes/assistant.ts` (PRD-101) | 0 |
| Inbox — open insights + email-derived items | `routes/family-inbox.ts` | Decide/Escalate surface |
| Draft outreach from an insight or playbook step — never sent | `insights/generate-draft.ts`, `POST /insights/:id/prepare`, life-event step prepare (PRD-103/108) | 1 |
| **Approve → execute real actions**: `send_email` (SendGrid), `send_whatsapp` (Twilio), `crm_tag`, `log_only` | `actions/action-executor.ts`, `POST /insights/:id/approve`, `action-preview` gate, `retry-execution` | 2 machinery — **see caveat below** |
| Signed one-click approve/dismiss + evidence links in notifications | `GET/POST /a/:token`, `GET /why/:token` | Human-in-loop without login |
| **Auto-execute trusted scopes**: opt-in + earned trust counter + `log_only` actions only + grace window + quota + dry-run honored | `jobs/auto-execute-trusted.ts`, `automation-settings.ts` (`auto_execute_enabled`, `trust_level_by_workflow`, `dry_run_mode`) | 3, narrow |
| Policy-renewal reminders that actually send (opt-in, configurable lead days, re-checked at send time) | `jobs/policy-renewal-reminders.ts`, `delivery` | 3, opt-in |
| Reminder transparency: list + cancel pending | `routes/reminders.ts` | Reversibility surface for Tier 3 |
| Marketing auto-publish after earned per-channel trust | `routes/marketing-posts.ts`, `marketing/social-publisher.ts` | 3, per `marketing_social:<channel>` scope |

**Caveat on Tier 2:** the executor can send real email/WhatsApp/CRM writes
on human approve, but family detector YAML `actions` are plain strings and
all classify `log_only` — nothing in the family vertical ever emits an
external action type. Tier 2 is wired end-to-end but unexercised by real
detectors; exercising it is an action-taxonomy + YAML change, not new
plumbing.

### Delivery & ingestion

- **DeliveryRouter** (`delivery/delivery-router.ts`): per-tenant channel
  preferences + urgency floor, WhatsApp→SMS→email fallback, web push and
  Expo push senders, signed one-click tokens, dedup, delivery receipts.
  `routes/push.ts` is the registration half.
- **AI Memory / ingestion**: `documents.ts` + `ocr/extract.ts` (GPT-4o
  vision; OpenAI or Azure), `ocr/profile-mapping.ts` proposes `policies[]`
  updates a human approves — extraction never writes unreviewed.
  `jobs/email-scan.ts` runs allow-listed Gmail/IMAP attachments through
  the same pipeline, entitlement-gated (`email_ai_summary`).
- **Connectors**: generic OAuth + encrypted credential store
  (`connector-credentials.ts`), `ConnectorSyncEngine` +
  `TokenRefreshScheduler` (`@agentoak/pipeline`), webhook ingest queue +
  worker with dead-letter + operator requeue. **Only email (Gmail OAuth +
  generic IMAP via `family-connectors.ts`) is functionally live**; the
  other ~33 `connectors/*.yaml` (open-banking, stripe, xero, trading-212,
  rightmove…) are definitions without a running consumer.

### Ops / growth / platform (a whole second product)

- **Operator console**: `/operator` with 14 sections — tenants, users,
  leads CRM (pipeline stages), support inbox, marketing drafts,
  operations (queue depth, dead letters, runbooks from `runbooks.yaml`,
  alert triage), audit, billing, configuration, promotions, content.
- **Autopilot** (`operator/autopilot.ts`): hourly rule-driven ops actions
  (e.g. dead-letter requeue once), all rules default-off.
- **Lifecycle email** (`marketing/lifecycle-emails.ts`): welcome/nudge/
  upgrade/trial winback sequences keyed off real account state, suppression
  aware.
- **Social publishing**: draft→approve→publish to X/LinkedIn/Bluesky, with
  per-channel earned trust and dry-run support; detector-driven blog
  content (`detector-content-posts.ts`, PRD-202).
- **Billing**: Stripe checkout/webhooks, plan lifecycle, credit ledger,
  quotas (`enforceQuota`), payment-failure grace + auto-downgrade, promo
  codes, admin adjustments (`routes/billing.ts`, `jobs/billing-cron.ts`).
- **Support**: AI-first triage grounded only in account state (never the
  financial profile), escalating to human-visible cases (`support.ts`).
- **Platform**: JWT auth + scrypt + lockout, Google/GitHub OAuth, RBAC
  abilities, tenant-scoped collections, audit log (7-yr TTL) + read
  surface, Prometheus metrics, cron locking (`jobs/cron-lock.ts`) so jobs
  don't double-run across instances.
- **Growth**: first-party funnel events, referrals with reward-on-first-
  real-use (PRD-112), invite codes.

## Dormant / dead weight (in-repo, not live)

- `goals/` (`kpi-source-reconciliation`, `progress-compute`) and the
  `goal-*` jobs + `kpi-compute-engine` + `social-analytics-poller` —
  **never scheduled, no routes**; legacy monorepo remnants. `account.ts`
  still exports the `goals` collection in the GDPR bundle, so it isn't
  fully severed.
- `outcomes/` (`causal-experiments`, `legacy-goal-outcome-bridge`,
  `reasoning-context-builder`) — no route imports found.
- `@agentoak/workflows`' rebuilt durable engine (`src/engine/`) — per its
  own package.json, "not yet wired to any apps/api route."
- `verticals/` non-family definitions (trading, property, SMB,
  audience-growth, branding) and most connector YAMLs — definitions only.
- `routes/blog.ts` write surface + `routes/case-studies.ts` — parked,
  documented as such in their module docs.

## Gaps vs the vision brief (ranked by structural weight)

| # | Vision item | Reality | Size |
|---|---|---|---|
| 1 | **Member micro-agents** — Adult twins (career/pension/protection/estate) + Youth twins (education/literacy) that grow with each member | **Partially resolved (PRD-117, same session):** the per-member *read model* now exists — `GET /family/members/:id/twin` assembles earner slice + attributed policies/funds/insights fresh on read, `?member_id=` filters `/insights`, and `/member/[id]` renders the twin. Still missing: member-scoped *reasoning* (a per-member agent loop/persona), youth-facing surfaces, and member-scoped detector coverage beyond protection/education. | M — personas + member-scoped reasoning on top of the now-shipped read model. |
| 2 | ~~**Composite Family Readiness Score** owned server-side~~ | ✅ **Resolved (PRD-114, same session):** `GET /family/readiness` + `readiness/score.ts` ship deterministic server-side subscores (emergency fund, protection, retirement, education, estate via vault `doc_type` coverage — a new upload field), adult-gated estate, honesty on never-evaluated profiles. Web keeps the old penalty math only as labeled offline fallback. Remaining slivers: estate-completion *detector* (score detail strings only today), per-member splits (PRD-117), quiz alignment. | — |
| 3 | ~~**Time-shifted scenario simulation** ("job transition in six months")~~ | ✅ **Resolved (PRD-115, same session):** `monthsUntilChange` horizon in `calculate.ts` (fund grows/drains until the change lands), `family_scenarios` collection + preview/CRUD routes recomputing on read, `SimulateSchema` + narration updated, first web surface on `/events/job-loss`. Remaining: multi-step timelines, per-member scoping. | — |
| 4 | **Dead man's switch / emergency proxy delegation** | Deliberately absent — standing adult access + awareness reminders shipped instead (`vault-reminder.ts` documents the re-scope). A true release mechanism needs dedicated design sign-off at the right trust tier; note it also *contradicts* the current access model (nothing is locked to release). | Design decision first; if built, the vault's access model must change to have something to release. |
| 5 | **Client-side (zero-knowledge) vault encryption** | Server-side AES-256-GCM today — the operator (us) can technically decrypt. The brief's "client-side encrypted" implies we can't. | M: key management redesign; decide whether the vision actually requires zero-knowledge. |
| 6 | **Action Network** — real bank/insurer/airline/hospital integrations | Zero live providers. `open-banking.yaml` and ~33 other connector definitions are dormant; only email is wired. Tier 2 autonomous actions have nothing to act through. | L — primarily BD/partnerships; open banking (account info only, *not* payment initiation) is the tractable first step and stays inside the regulated-activity boundary. |
| 7 | **Youth-twin specifics** — savings buckets, progressive financial literacy, age-appropriate surfaces | Nothing child-facing exists; children are roster rows feeding education detectors. | M, gated on #1. Also raises minors-and-data questions worth a dedicated pass. |
| 8 | **Health / life-assets / context / preferences domains** | Absent. `/health/[domain]` is *financial-health* scoring, not medical. Preferences exist only as delivery/automation settings, not decision-rights modeling. | Deliberately deferred (GDPR special-category) — keep it that way until the consent model is proven. |
| 9 | **Live cash-flow / runway feed** | Income/expenses are self-reported snapshots; runway is computed only inside `simulate`. No transaction stream keeps the twin current between profile edits. | Blocked on #6. |
| 10 | ~~**Tier 2 actions exercised in the family vertical**~~ | ✅ **Resolved (PRD-116, same session):** detector-declared `action_intents` (typed, authoritative over the keyword classifier in both directions) on `DetectorRuleSchema`/`TriggerSchema`; first live intent is `policy_renewal_window`'s self-send renewal-reminder email — approve remains the consent gate, declared external intents are categorically ineligible for auto-execute. Third-party-directed sends stay Tier-1 draft-only per PRD-103. | — |

## Doc corrections made during this audit

- `ARCHITECTURE.md` previously said "nothing beyond Tier 1 exists" —
  wrong: approve→execute, auto-execute-trusted, renewal reminders, and
  marketing auto-publish are all live. The vision table and trust-tier
  section were updated to reflect this.
- "No scenario simulation" was wrong — `POST /assistant/simulate` +
  `scenarios/calculate.ts` do deterministic what-if math. Corrected to
  "no time-shifted/persisted simulation."
- The implemented-architecture diagram was missing vault, life-events,
  leads, operator/autopilot, marketing/lifecycle, and notifications —
  updated.
