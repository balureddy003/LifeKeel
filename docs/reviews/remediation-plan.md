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
   nowhere, superseded by `AskKeelButton`. Pure deletion.
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
    place the product's core "LifeKeel knows what to do next" promise fails a
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
    consumer product only ever sells one real plan ("Keel Plus" via
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

**XL 28 — SHIPPED.** Family sharing / secondary-user access — scoped as
[110-family-sharing-secondary-user-access.md](../prd/110-family-sharing-secondary-user-access.md)
and then implemented end to end. Deliberately narrower than the original
4-part sketch above: adults only for v1 (child accounts flagged as their
own, separate consent surface, not bundled in), full-access-only (no
per-field permission cut yet), and reuses the family's existing,
already-displayed `invite_code` as a durable, revocable family code
rather than a parallel single-use-token system — the organizer-approval
step is what makes it safe, not the code's single-use-ness.

Grounded in the actual schema throughout, not assumed: the `users`
collection's only uniqueness constraint is on `email`, not `tenant_id` —
confirmed directly in `auth-users.ts` before writing a line of the new
route — and the organizer-only guard on the new endpoints is a genuinely
new check, not a reused one: every existing `/family/*` write (add member,
remove member, change role) only ever checked `tenant_id`, never role,
because there was never a second real login in a tenant to distinguish
from the organizer. `POST /family/join` never creates a `users` row or
grants any access by itself, no matter what code was entered — only an
explicit organizer approval does; this is the one property the whole PRD
exists to have, and it's the first thing the test suite (`family-join.test.ts`,
14 tests) asserts.

One naming deviation from the original PRD draft, caught and fixed before
shipping: the draft's `/family/join-requests` would have shared a prefix
with the public `/family/join` in the server's auth allowlist (which
matches by `startsWith`), making the organizer-only list/approve/deny
endpoints public too. Renamed to `/family/access-requests` — zero prefix
collision, and documented in the PRD itself so the record matches what
actually shipped.

Verified via the full gate: typecheck (24/24 tasks), lint (clean), and the
full API suite (only the same pre-existing, Mongo-dependent
`ml-tenant-isolation` failures — one apparent extra failure mid-session
traced to a `mongodb-memory-server` port collision with a concurrently-
running session, confirmed as a flake by re-running that file in
isolation, not a regression). The Settings UI now makes the existing
"lets a partner or caregiver join" copy true rather than aspirational —
the specific gap this whole item was opened to close.

## Validation pass — 2026-09-19 (Claude)

Re-ran the full gate independently (`pnpm typecheck && pnpm lint && pnpm
test`, both apps) rather than trusting the implementation log above at face
value — clean: 24/24 typecheck tasks, lint clean (2 pre-existing unrelated
warnings only), 379/389 API tests passing (the 10 failures are the
documented `ml-tenant-isolation` suite, which needs a real MongoDB and is
expected to fail locally per CLAUDE.md), 58/58 web tests.

Spot-checked the two highest-stakes implementations directly against their
code, not just their tests: **#25's approve endpoint** genuinely respects
`dry_run_mode` (blocks real execution when set) and the `/insights/[id]`
screen structurally cannot render an Approve button before loading the same
`action-preview` classification the executor itself uses — the screen can't
drift from what actually runs. **#26's account deletion** sequences GridFS
blob deletion before metadata (avoiding orphaned blobs on partial failure),
documents exactly why `audit_log` is retained rather than wiped, and kills
outstanding JWTs via tenant status rather than attempting server-side token
revocation. Both read as genuinely load-bearing, not just tests-passing.

Then went deeper on the two items that matter most for a family in an
actual crisis (#18, #19) and found and fixed real gaps beyond what the
implementation log claimed:

- **No path in Emergency Mode or the life-event flow ever told a user to
  call emergency services.** A family opening "Emergency Mode" for a
  medical crisis or car accident was walked straight into insurance/
  financial admin steps — correct scope for a financial assistant, but
  missing the one line that has to outrank everything else when someone
  may be in physical danger. Added a life-safety notice ("If anyone is in
  immediate danger, call 911 now") to: the Emergency Mode overlay itself
  (shown unconditionally, above every tile, before any selection), and the
  `/life-events` report screen + playbook detail screen for the four
  physically-urgent types (medical, car, property, travel) — since both
  pages are reachable directly, not only through Emergency Mode.
- **Stale button copy.** "This is actually happening" made sense when it
  was the *only* path into the real, tracked flow (vs. the tiles going to
  the hypothetical simulator) — now that #18 routes every tile into the
  real flow too, the button's old wording was confusing residue. Reworded
  to "Something else — see all event types," its actual remaining purpose
  (job loss, disability, or a full picker).
- **No Escape-key handler on the Emergency Mode overlay.** `useFocusTrap`
  only handles Tab-cycling, not Escape — confirmed by reading the hook
  directly, and confirmed `CommandPalette` (the app's other full-screen
  overlay) already has its own separate Escape handler for the same
  reason. Added the same pattern to `EmergencyMode.tsx` rather than baking
  it into the shared hook (which would have double-fired for
  CommandPalette).
- **Minor drift risk removed, not just cosmetic:** `LifeEventPlaybookClient`
  carried a 3-entry hardcoded title map that silently fell back to
  `playbook.title` for the 4 newer event types. Confirmed the hardcoded
  strings were byte-identical to the YAML titles for all 3 covered types,
  then deleted the map — one source of truth, no "remember to update this
  too" trap for the next event type added.

**The most consequential finding of this pass**, from checking whether
#20 (PRD-110's `policies[].member_id`) is actually *used* anywhere, not
just stored: it isn't. `render-playbook.ts` never reads `member_id` for
any event type — including bereavement, the single highest-stakes
playbook in the product. `renderBereavementStep` didn't even receive
`affectedMemberId` as a parameter, so `notify_insurers` dumped every
household policy into one undifferentiated, urgent-sounding instruction —
meaning a family who just lost one parent could be told to "contact" the
*surviving* parent's own, unrelated life insurance policy in the same
breath as the actual death claim, during the worst week of their life.
Fixed: `renderBereavementStep` now takes `affectedMemberId`, splits
policies into the deceased's own (the real, urgent instruction), other
family members' (explicitly marked "don't need to be touched for this"),
and unattributed (flagged to confirm rather than silently guessed either
way) — falling back to the original undifferentiated list whenever no
policy has a `member_id` on file at all, so households with older data
see no regression. 3 new tests added (`render-playbook.test.ts`), all
passing; full typecheck/lint clean.

Deliberately did **not** apply the same split to `medical`'s
`check_health_cover`, after checking rather than assuming: bereavement's
action ("notify the insurer of a death") is intrinsically tied to one
person's own policy, so excluding others is a pure improvement. Medical's
health/critical-illness cover often covers *dependents* under one
policyholder's plan — if the affected person is a child, the relevant
policy structurally belongs to a parent, not them, so filtering to "only
the affected member's own attributed policy" would risk hiding the exact
cover that actually applies. `resolveEarner` already correctly threads
`affectedMemberId` through this same step for the income-protection part;
the policy-listing part is right to stay household-wide. Car and
property/home policies were never in scope for this either — the wizard
never asks for a member on those types, by design (PRD-110's own
acceptance criteria). No change made to any of the three; recorded here so
it reads as a checked-and-declined decision, not an unexamined gap.

All changes this pass verified via a full re-run of typecheck/lint/test
(unchanged: clean). Live browser verification was not possible this pass —
port 3002 was occupied by another session's dev server whose assets
weren't reachable from this session's browser tooling; correctness was
instead verified by matching the exact Tailwind/component patterns already
proven elsewhere in the same files (the `existingSameType` warning banner's
styling, `CommandPalette`'s Escape handler).

## Validation pass 2 — 2026-09-19 (Claude)

Swept #17, #27, and the S-tier (8–16), checking each against the actual
code rather than the implementation log's summary.

**#17 (one-step document-to-insight) and #27 (onboarding continuity)** —
both solid, no changes needed. #17: `regenerateInsights()` is correctly
gated on the stored profile parsing as a *complete* `FinancialProfile`
(never crashes or fires on an upsert-created skeleton), the real `engine`
is wired at boot (`server.ts`), and the frontend surfaces a clean "N new
insights generated" with a sensible 0-case fallback. #27: the
sessionStorage draft-resume correctly discards itself when the signed-in
account turns out to already have a family (no stale-draft resurrection),
and the wizard's onboarding pre-fill only carries over the child's *name*
— never a guessed numeric value, exactly the conservative-pre-fill bar
set for this item.

**S-tier 8–14, 16**: all confirmed solid on inspection — env-configurable
support email with an honest not-live-yet fallback (#8), a real
subscription-status poll after Stripe return (#9), `reportError` wired
into both `fetchAIResponse` failure paths (#10), `signIn()` now correctly
throws (not silently swallows) on a genuine family-fetch failure while
`fetchFamilyGroup()` itself distinguishes "no family yet" from "couldn't
check" at the source (#11), the OAuth callback keeps the real error
visible instead of a 2s auto-redirect and reports it (#12), a real
in-memory retry queue with an `online`-event listener plus a manual retry
button (#13), a persistent autosave-failure indicator (#14), and the
public quiz now branded distinctly as "Family Readiness Check," separate
from the in-app "readiness score" (#16).

**#15 (Investments/Pension merge) — found genuinely incomplete, fixed.**
The navigation-level fix was real (`familySections.ts`'s `ROLE_BRANCHES`
no longer lists "Investments" as a clickable row), but the underlying
`/asset/investments` *route* still fully rendered — same `RetirementDetail`
component, same data, under a different label — for anyone who reached it
directly (a stale bookmark, an old in-app link, a search-indexed URL). The
"two rows, one dataset" problem this item exists to close was still there,
one layer down. Fixed: `/asset/investments` now redirects to
`/asset/pension` instead of rendering a duplicate; removed the now-dead
`investments` entry from `ASSET_META` and its unused `TrendingUp` icon
import; updated the stale code comment in `assets-data.ts` that claimed
"nothing navigates there anymore" without accounting for direct URL access.

Verified via a full typecheck/lint/test re-run — a build failure hit
mid-check (`Cannot read properties of undefined (reading 'call')` while
prerendering `/`) turned out to be stale `.next` build-cache corruption,
most likely from the other session's concurrently-running dev server
writing to the same directory, not a real regression — confirmed by
clearing `.next` and rebuilding clean. 58/58 web tests still passing.

**#21 (connector sync UI), #22 (audit log viewer), #23 (billing tier
decision), #24 (orphaned backend cleanup)** — all solid, all genuinely
"decide and document" rather than silent accumulation. #21: real polling
while a backfill is in flight, a last-sync-failed banner surfaced from
`GET /connectors/:id/sync/status`. #22: `GET /audit-log` registered at
boot, a real paginated viewer translating raw action ids
(`insight.approve`, `billing.plan_upgraded`, …) into plain-English labels.
#23: `POST /billing/checkout` now explicitly rejects `growth`/`enterprise`
with a clear 400 instead of the previous silent path to a Stripe 500 from
an unconfigured placeholder price id. #24: `settings.ts` (~970 unused
lines) genuinely deleted; `blog.ts`'s and `case-studies.ts`'s write
surfaces deliberately parked, not deleted, each with a documented reason
(blog: `LIFEKEEL_ADMIN_KEY`-gated, unusable without the env var set —
verified directly, `Boolean(undefined && ...)` short-circuits false
regardless of header; case-studies: `GET /case-studies` is a live public
marketing endpoint, deleting the file on spec would remove more than dead
code).

Found one more real defect while re-reading my own #15 fix from the first
pass: `RetirementDetail`'s trailing disclaimer ("{label} isn't tracked as
a separate account yet") made sense when `label` could be "Investments"
(the actual point being made: "this isn't a real separate account, we're
reusing pension data") — now that the `investments` branch is gone and
`label` is always "Pension", the sentence read as self-contradictory
directly under a "Pension Balance" heading. Simplified to a plain "These
figures come from your Financial Profile," and dropped the now-unused
`label` prop entirely. Re-verified clean: typecheck, lint, and 58/58 web
tests.

This closes out the validation pass on every implemented item (1–27).
Only #28 (family sharing) remains, deferred by the plan's own design.
