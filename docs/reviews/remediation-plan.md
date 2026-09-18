# Remediation plan — every gap, smallest to largest

As of 2026-09-18 · reviewed by Claude Code

## How to read this

Every gap identified in [user-journeys-acceptance-criteria-gaps.md](user-journeys-acceptance-criteria-gaps.md)
and [product-review-council.md](product-review-council.md), sized by
implementation effort — XS through XL — and ordered smallest to largest
within each tier. Sizing is scope, not urgency: number of files touched,
whether a schema or new endpoint is involved, whether it's contained to
one layer (frontend-only) or cross-cutting (schema + backend + frontend +
tests), and whether it depends on something outside engineering entirely
(a partner integration, a legal/compliance decision).

**Smallest-to-largest is not the same as build order.** Two items below
are called out explicitly because their *risk* outranks their *size* —
Emergency Mode routing (M) and the Act-layer approval gate (L) — and
should be sequenced ahead of same-tier or even larger items regardless of
where they sit in this list. Everything else is genuinely fine to work
top-to-bottom for quick wins first.

PRD-109 (policy extraction → profile bridge) has already shipped as of
this plan's writing — it's the one item from the original gap list that's
been implemented and tested. It's kept here, marked done, for a complete
record.

---

## XS — hours, one file, no schema or endpoint change

1. **Elderly-mode tile labels.** "Call Insurance"/"Call Son" don't call
   anyone — rename to "View Insurance"/"View Son" until a real phone
   field exists. One component, copy-only.
2. **Member-detail not-found link.** Unknown `/member/[id]` links back to
   `/` instead of `/family`, inconsistent with the asset-detail page's own
   pattern. One-line fix.
3. **Sign-out destination.** `signOut()` routes to `/welcome` instead of
   `/login` — a small inconsistency for a returning user. One-line fix.
4. **Delete `AIFloatingButton.tsx`.** Confirmed dead code, imported
   nowhere, superseded by `AskOakButton`. Pure deletion.
5. **Link `/support` from Settings.** The page exists and works for
   logged-out users; nothing links to it once authenticated. One link.
6. **Surface onboarding's silent recovery-email failure.** Currently
   swallowed as "best-effort" with no user-visible signal. One error
   state, no new plumbing.
7. **Readiness quiz retry.** `score === null` shows a dead-end error card
   with no way to retry without re-filling the form. One button.

## S — one or two files, contained logic, no schema change

8. **Support page's actual contact path.** Replace the literal placeholder
   string `[support@yourdomain.example]` with a real, working `mailto:`
   link at minimum. (The *capability* gap — no deletion/export endpoint
   exists — is a separate, larger item below; this is the immediate
   "stop actively lying to the user" fix.)
9. **Upgrade page auto-poll.** After Stripe's `?success=true` return, poll
   subscription status for ~30s instead of requiring a manual refresh.
10. **`fetchAIResponse` error reporting.** Route its failure path through
    the same `reportError()` convention the rest of `api.ts` already
    uses — closes an operational blind spot with no user-facing change.
11. **Login's silent onboarding fallback.** A transient family-fetch
    failure during `signIn()` currently drops the user back into
    onboarding with no explanation; surface it as a retryable error
    instead.
12. **OAuth callback error handling.** An `error` param currently flashes
    for 2s then hard-redirects to `/login`, discarding the actual error
    text. Keep it visible, or at least log it before redirecting.
13. **Upload's offline-retry promise.** Copy says "will sync when
    reconnected" — either build the retry, or remove the claim. Pick one;
    both are S-sized, the current state (claim with no mechanism) is the
    only bad option.
14. **Financial Profile autosave failures.** Currently silent outside the
    version-conflict case. Add a persistent per-step "not saved" indicator.
15. **Asset-detail Investments/Pension.** They render the identical
    `RetirementDetail` component under different labels — either merge the
    labels honestly or give them real distinct data. Merging the labels is
    the S-sized option; real distinction is M/L depending on scope.
16. **Readiness-quiz naming collision.** The public quiz and the in-app
    "readiness score" share a name but are different metrics. Add a link
    from the quiz result into the in-app flow, or rename one.

## M — schema or new endpoint, several files, needs its own tests

17. **One-step document-to-insight flow.** Applying extracted document
    fields to the Financial Profile doesn't currently trigger insight
    regeneration — requires a second manual "Save & Generate Insights"
    step. Merge the two, debounced if multiple documents are applied in a
    session.
18. **⚠ Emergency Mode routing — do this regardless of tier order.** All 5
    crisis tiles currently route to the hypothetical `/events/[eventId]`
    simulator, not the real, tracked `/life-events` flow; car, property,
    and travel have no real-flow equivalent at all. Extend `EVENT_TYPES`
    to cover the full taxonomy, carry the picked type through as a route
    param, add a lightweight confirm + de-dupe check. This is the one
    place the product's core "Oak knows what to do next" promise fails a
    user at the exact moment it matters — see the Journey 1 write-up in
    `product-review-council.md` for the full redesign.
19. **Life-event checklist backend sync.** Step-completion is currently
    localStorage-only — no endpoint exists for it at all. Two family
    members coordinating a real event on separate devices each see a
    blank checklist. Needs a new persistence endpoint plus a small
    frontend change to read/write it instead of `localStorage`.
20. **Policy per-member attribution (PRD-110).** Already scoped with
    concrete acceptance criteria in
    [user-journeys-acceptance-criteria-gaps.md](user-journeys-acceptance-criteria-gaps.md#policy-per-member-attribution--detailed-finding):
    optional `member_id` on `policies[]`, a member picker in the wizard
    for person-scoped policy types, the PRD-109 OCR bridge carrying a
    member field, and an assistant-grounding update — the same shape of
    fix PRD-104 already proved out for employment/income.
21. **Connector backfill/sync-status UI.** `POST /connectors/:id/backfill`
    and `GET /connectors/:id/sync/status` already exist server-side with
    no frontend caller — surface sync progress and a manual re-trigger.
22. **Audit log viewer.** Every security-relevant action is already logged
    with a 7-year TTL (`audit-log.ts`) with no viewer anywhere. A
    read-only page over an existing, working backend.
23. **Dormant 4-tier billing system — decide and document.** `free` /
    `starter` / `growth` / `enterprise` with quotas, credit packs, and
    outcome-based pricing exist in `billing-constants.ts`, but the
    consumer product only ever sells one real plan ("Oak Plus" via
    `starter`). Mostly a decision task (delete the unused tiers' scaffolding,
    or explicitly document why they're kept for a future B2B path) —
    sized M because touching billing code always warrants care and tests,
    not because the logic itself is complex.
24. **Orphaned Studio/admin backend — decide and document.** The ~15
    unused endpoints in `settings.ts` (LLM config, SSO, detector priority,
    ML isolation, benchmarks), plus case studies and blog-admin routes.
    Same treatment as #23: an explicit delete-or-park decision per surface,
    not silent accumulation. Sizing varies per sub-item; grouped here as
    the typical case.

## L — cross-cutting, new subsystem, or real UX + backend redesign

25. **⚠ Trust-tier / Act-layer approval gate — the single most
    consequential item in this whole review, independent of its size.**
    `action-executor.ts` already contains live Tier 2+ dispatch code (real
    SendGrid email, Twilio WhatsApp, HubSpot CRM tagging) reachable via
    `POST /insights/:id/approve`, with zero approval-gate UI in front of
    it — directly contradicting `ARCHITECTURE.md`'s "no autonomous Act
    exists" claim and leaving CLAUDE.md's core safety rule unenforced in
    code. Build the approval-gate screen (and the dry-run/trust-level
    settings screen the backend already has fields for) **before**
    anything in `apps/web` is allowed to call `approve`. This should be
    treated as a prerequisite that blocks other Act-layer work, not a
    backlog item competing on size.
26. **Real account-deletion / data-export capability.** No such endpoint
    exists anywhere in the API — confirmed against every route file. This
    is a genuine compliance gap (the privacy policy already admits it in
    fine print), not just the support-page UI fix in item #8. Needs its
    own scoped design: what "delete" means given detector history and the
    7-year audit-log retention, and whether it's immediate or
    request-and-fulfill.
27. **Onboarding continuity redesign.** Preserve the collected chat state
    across the login-collision redirect (today it's discarded entirely),
    carry chat answers into the Financial Profile wizard as conservative
    pre-fill, and end onboarding with one real, specific insight instead
    of a blank 0-state dashboard. Touches `ConversationalOnboarding.tsx`,
    the signup/login flows, and the wizard's `fromProfile`/pre-fill logic.

## XL — multi-week, foundational

28. **Family sharing / secondary-user access.** The biggest gap in the
    product relative to its own name. Today "family" is one login with a
    roster attached — the displayed invite code redeems nowhere, and
    self-serve signup can't join an existing tenant. Needs: a real
    `/invite/[code]` acceptance flow with expiring single-use tokens, an
    organizer-confirmation step before access activates, a second real
    login scoped to the existing family (not a new tenant), and a first,
    narrow cut of per-member permissions (a spouse gets full access, a
    child gets read-only access to their own designated items). This is
    also the single highest-value item in the review — a multiplier on
    every other journey's value, not just its own feature.

---

## Summary by tier

| Tier | Items | What it buys |
| --- | --- | --- |
| XS | 7 | An afternoon of cleanup; no behavior risk |
| S | 9 | A day or two each; closes several "product actively over-promises" gaps (support page, offline sync, autosave) |
| M | 8 | A sprint-sized item each; includes the two @⚠ risk-overrides-size items and the policy-attribution PRD-110 |
| L | 3 | Multi-sprint; the Act-layer gate here is the one item in this entire plan that should be treated as non-negotiable before any related feature work continues |
| XL | 1 | Family sharing — a dedicated project, not a backlog item; recommend scoping its own PRD before starting |

---

## Implementation status — 2026-09-19 (Devin)

All 27 in-scope items are implemented or verified; #28 remains deferred per
the plan's own guidance (XL, needs a dedicated PRD before any work starts).

**XS 1–7.** Six were already fixed between the review and implementation
(tile labels, member-detail link, sign-out destination, dead
`AIFloatingButton`, `/support` link, recovery-email failure surfacing).
#7 implemented: the quiz error card now retries without re-filling.

**S 8–16.** #8: support email is env-configurable
(`NEXT_PUBLIC_SUPPORT_EMAIL`) — a real `mailto:` when set, honest
not-live-yet copy when unset; no fake address. #9–13: upgrade auto-poll,
`fetchAIResponse` error reporting, `fetchFamilyGroup` throwing on real
failures (login no longer silently re-onboards), persistent OAuth-callback
errors, real offline upload retry (memory queue + `online` listener +
manual retry). #14: persistent "not saved" indicator for non-409 autosave
failures. #15: merged Investments/Pension into one honest entry. #16:
public quiz renamed "Family Readiness Check" with copy distinguishing it
from the detector-driven readiness score.

**M 17–24.** #17: document apply-to-profile and apply-policy now regenerate
insights in-request via the extracted `evaluateProfileAndGenerateInsights`
helper; UI surfaces the count. #18 ⚠: Emergency Mode routes medical/car/
property/travel into real tracked life events — seven-type taxonomy, four
new playbooks, `?type=` param, de-dupe warning. #19: checklist completion
is server-persisted (`POST /family/life-events/:id/steps/:stepId/complete`)
with optimistic UI + server-authoritative sync. #20: `policies[].member_id`
end-to-end (schema, wizard picker, document bridge, detector event data,
assistant grounding). #21: connector sync-status + manual re-trigger UI.
#22: `GET /audit-log` + read-only viewer linked from Settings. #23: only
`starter` is a real plan — checkout for unconfigured tiers now fails with
a clear "not available" instead of sending placeholder price IDs to
Stripe. #24: unregistered `settings.ts` (~970 lines) deleted; blog public
GETs kept (live callers); blog admin writes + case studies parked and
documented — mounted, auth-gated, zero UI callers.

**L 25–27.** #25 ⚠: the Act-layer approval gate now exists end-to-end —
`GET /insights/:id/action-preview` (per-action classified effects via the
executor's own classifier), live `GET/PATCH /settings/automation` for the
pre-existing `dry_run_mode`/`trust_level_by_workflow` fields, a dedicated
`/insights/[id]` gate screen showing what each action will actually do
before Approve/Dismiss/Prepare-draft (with retry on `execution_failed`),
entry links on health insight cards, and an automation settings screen.
Approve stays atomic (`identified`-only), attributed (`approved_by`/
`approved_at`), audited, and retry-execution cannot fire for an unapproved
insight. #26: `GET /account/export` (JSON bundle of tenant data) and
`POST /account/delete` (typed-email confirmation, immediate wipe of
tenant-tagged collections + GridFS blobs, tenant marked `deleted` so
outstanding JWTs die at the auth check; `audit_log` and billing records
retained on documented schedules). Self-service UI in Settings; privacy
policy updated to match. #27: onboarding chat state survives the
login-collision redirect (sessionStorage draft + auto-resume after
sign-in), the wizard's roster pre-fill covers the chat answers, and
onboarding now continues into the Financial Profile — the honest path to
a first real insight, since no detector can fire on names alone.

**XL 28 — DEFERRED.** Family sharing / secondary-user access: not started,
by design — the plan itself requires a dedicated PRD first (invite
acceptance flow, organizer confirmation, second real login, per-member
permissions cut).
