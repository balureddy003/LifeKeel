# PRD-110: Family sharing — a second real login for the same family

## Problem

Traced end to end, not assumed: "family" today is one authenticated login
with a roster attached, not a multi-user product. `family_groups` already
generates and displays an `invite_code` (`family-group.ts:79-88,115`) with
UI copy promising it "lets a partner or caregiver join" (Settings, Home's
invite banner) — but nothing redeems it. There is no `/family/join`
endpoint and no `/invite/[code]` page anywhere in `apps/web`. Separately,
`auth-users.ts` has its own, unrelated `invite_code` concept
(`checkInviteCode`/`consumeInviteCode`, `auth-users.ts:116,147`) — that one
is a platform-wide signup gate (does this code let *anyone* sign up at
all), not a per-family join mechanism, and its own code comment says so
explicitly (`auth-users.ts:132-139`): *"There is no invite mechanism
scoped to a specific tenant... an unclaimed workspace-name collision must
be rejected outright."* Confirmed structurally that a second real user
*can* share a `tenant_id` — the `users` collection's only uniqueness
constraint is on `email` (`auth-users.ts:81`), not `tenant_id` — so nothing
in the schema blocks this; nothing in any route *creates* it.

The result, named plainly in the Journey 5 review: a spouse, adult child,
or caregiver has no way to ever log in as themselves. A "family" digital
twin that only one person can actually use isn't a family product — this
is the largest gap between what the product is named and what it does,
and (per that same review) a multiplier on every other journey's value,
not just its own feature: the life-event playbooks, the shared checklist
sync (PRD-108/remediation item 19), the assistant's grounded answers —
all of it is only ever seen by one person today.

## Market bar

See [000](000-market-landscape-and-positioning.md). Every family life-admin
competitor researched there assumes multiple real household members with
their own access as table stakes, not a differentiator — this PRD closes
a gap to parity, it doesn't create new differentiation. What *would* be
differentiated, and is explicitly **out of scope** for this PRD (see
below), is permission-aware reasoning that adapts to who's asking — that's
a real, later opportunity once a second identity exists to reason about at
all.

## Who it's for

Any household where more than one adult needs to see and act on the same
family's real data — the common case, not the edge case. Scoped
deliberately to **adults only** for v1 (see Scope) — a spouse, an adult
child helping manage a parent's affairs, or a caregiver the organizer
explicitly approves.

## What "done" looks like

The `invite_code` already shown in Settings and on Home's invite banner
becomes real. A second person enters it at `/invite/[code]`, gives their
own name/email/password, and lands in a **pending** state — nothing about
their access activates yet. The organizer sees a "Jane wants to join"
request (same list style as the existing "Family Members" section in
Settings) and explicitly approves or denies it. On approval, a real
`users` row is created sharing the family's existing `tenant_id` (not a
new tenant — the exact gap `auth-users.ts:140-144` currently guards
against for *unapproved* joins), linked to a roster entry so the person
appears as themselves, not as an anonymous addition. They can now sign in
independently and see the same real family data the organizer sees —
including a life-event a spouse reported, which they can pick up on their
own device instead of hearing about it secondhand.

The `invite_code` itself stays a **durable, revocable family code** (like
a Wi-Fi password), not a single-use token minted per invitation — it's
already generated once and displayed persistently, and switching that
model isn't necessary for safety: the organizer-approval step, not the
code's single-use-ness, is what stops a forwarded or leaked code from
granting real access (see Trust tier). The organizer gains a "Reset invite
code" action so a leaked code can be invalidated without waiting on
per-invite expiry.

## Trust tier

**Tier 0 for the join request itself** (a signup form and a pending-state
record — no external side effect). **A new, narrow pattern for the
approval step**: this isn't the Act layer's Tier 1-3 model (no external
provider is contacted), but it deliberately mirrors that model's core
discipline — nothing observable happens until a human takes an explicit,
named action. Concretely: `POST /family/join` never creates a `users` row
and never grants any access by itself, no matter what code was entered;
only `POST /family/access-requests/:id/approve`, called by the existing
organizer, does. This is the same "prepare, don't auto-execute" posture
CLAUDE.md's trust-tier rule requires for the Act layer, applied here to
account access instead of financial/legal/medical actions — because
granting a stranger real access to a family's financial and life-event
data carries comparable stakes to the actions that rule was written for.

## Scope

1. **`POST /family/join`** (public, no auth required — this is the entry
   point *before* anyone has a login): body `{invite_code, name, email,
   password}`. Validates the code against `family_groups.invite_code`,
   validates the email isn't already registered (same global-uniqueness
   check `auth-users.ts` already does), and creates a
   `family_join_requests` record: `{id, tenant_id, name, email,
   password_hash, salt, status: 'pending', requested_at}`. Does **not**
   touch the `users` or `tenants` collections yet.
2. **`GET /family/access-requests`** and **`POST
   /family/access-requests/:id/approve`** / **`.../deny`** — organizer-only.
   Named `access-requests`, not `join-requests`, deliberately: the server's
   auth middleware allowlists public routes by prefix match, and
   `/family/join-requests` would have shared a prefix with the public
   `/family/join`, making these organizer-only endpoints public too.
   The organizer check itself is new, not reused — checked directly against
   the code before writing this: every existing `/family/*` write today
   (add member, remove member, change role) only checks `tenant_id`, never
   role, because there was never a second real login in a tenant to
   distinguish from the organizer. Approve: creates the real `users` row
   (reusing `auth-users.ts`'s existing user-creation shape, `tenant_id` =
   the family's own, not freshly slugified), links it to a
   `family_groups.members[]` entry (`status: 'active'`, matching the
   requester's name), deletes the join-request record, and returns a
   sign-in-ready confirmation the frontend can route the *organizer* to
   ("Jane can now sign in"). The requester finds out by trying to sign in
   with the password they already set — no email delivery required for
   v1 (see Out of scope).
3. **`POST /family/invite-code/reset`** — organizer-only, regenerates
   `family_groups.invite_code`, invalidating the old one (any join
   requests already pending against it stay valid — they're tied to the
   tenant, not the specific code string).
4. **`/invite/[code]` page** (`apps/web`) — reads the code from the URL,
   collects name/email/password, calls `/family/join`, then shows a
   "Waiting for [organizer's name] to approve" state. No polling in v1 —
   the person is told to try signing in later (see Out of scope for a
   real-time notification follow-up).
5. **Settings**: a new "Join requests" row (only visible/populated for the
   organizer, same conditional pattern the existing member-removal
   protection already uses) listing pending requests with
   Approve/Deny; a "Reset invite code" action alongside the existing
   invite-code display.
6. **Existing UI copy that already promises this** ("lets a partner or
   caregiver join," the invite banner, the Settings invite-code row)
   needs no rewording once this ships — it becomes true rather than
   aspirational, which is part of why this closes the gap rather than
   just adding a feature.

Out of scope for this PRD, named explicitly rather than left implicit:

- **Child accounts.** A real login for a minor is a materially different
  consent/safety surface (age verification, parental-control expectations,
  COPPA-adjacent territory in some jurisdictions) than an adult spouse or
  caregiver signing in — bundling it into this PRD would either under-scope
  child safety or over-scope this PRD. Children stay roster entries only,
  exactly as today (an organizer-managed representation, not their own
  login), until a dedicated PRD reasons through that surface on its own.
- **Per-member data permissions beyond "full access."** Every approved
  adult sees everything the organizer sees — no per-field read/write
  restrictions, no "spouse can see finances but not documents" granularity.
  This is deliberately the narrowest useful slice (per the Journey 5
  review's own "ship the 20%" framing): a second real login that actually
  works is the multiplier; fine-grained permissions are a real, separable
  next step once a second identity exists to reason about at all.
- **Email delivery for invites or approval notifications.** The organizer
  shares the code out-of-band (text, call, in person) exactly as the
  already-shipped UI implies today; the requester checks back to sign in
  rather than receiving a "you're approved" email. A real notification
  path is a natural, cheap follow-up once this ships, not a blocker to
  shipping it.
- **Tying `mode-context`'s persona toggle (organizer/parent/adult/elderly)
  to the authenticated identity.** It stays a local, per-device preference
  exactly as it behaves today. Making a second real user's mode reflect
  their actual role rather than a free toggle is a reasonable follow-up,
  not required for a second login to be genuinely useful.
- **Revoking access after approval** (removing a joined member's login,
  not just their roster entry). The existing `DELETE
  /family/members/:id` continues to remove someone from the roster;
  whether their `users` row and standing session should also be killed at
  that point is a real question this PRD doesn't answer — flagged, not
  solved, since it's a second, separable piece of work (parallels the
  account-deletion JWT-invalidation pattern remediation item 26 already
  established, and should probably reuse it).

## Success metrics

- **% of multi-adult households (2+ non-child roster members) with a
  second real login created** within 30 days of this shipping — the
  direct measure of whether "family" becomes true in practice, not just
  in the marketing page's language.
- **Join-request approval latency** (time from request to organizer
  action) — if this is long, the no-notification v1 scope decision
  (Out of scope, item 3) needs revisiting sooner than a "natural follow-up."
- **Second-login activity relative to the organizer's** (insights viewed,
  life-events opened, assistant questions asked) — tests whether a joined
  member actually uses their own access for something real, not just
  completes the join flow once and reverts to hearing things secondhand.

## Acceptance criteria

- Entering a family's real `invite_code` at `/invite/[code]` and
  completing the form creates a `family_join_requests` record and
  explicitly does **not** create a `users` row or grant any access — a
  fixture asserting `db.collection('users').countDocuments()` is unchanged
  after this step is a hard requirement, not a nice-to-have, given this
  PRD's own Trust tier framing.
- The organizer approving a request creates a real `users` row sharing the
  family's existing `tenant_id`; the approved person can then sign in
  independently via the normal `/login` flow and see the same
  `family_financial_profile`, insights, and life-events the organizer
  sees — not a copy, the same tenant-scoped data.
- A non-organizer roster member (parent/adult role) cannot see, approve,
  or deny join requests — `GET /family/access-requests` and the
  approve/deny endpoints 403 for anyone but the organizer.
- Resetting the invite code invalidates the old code string for *new*
  join attempts, without disturbing any `family_join_requests` already
  pending from before the reset.
- A join attempt with an invalid or already-reset code fails with a clear
  error, not a 500, and creates no record.
- A join attempt using an email already registered anywhere in the
  product (not just this tenant) fails with the same "Email already
  registered" message signup already uses — no separate, inconsistent
  error path.
- Regression: the existing single-login flow (signup → onboarding →
  organizer-only usage) behaves identically for a household that never
  uses this feature at all.

## Implementation status — 2026-09-19

Shipped as scoped above, with one naming deviation from the original
draft (documented inline in Scope item 2): `/family/access-requests`
instead of `/family/join-requests`, to avoid a prefix collision with the
public `/family/join` route in the server's auth allowlist.

Backend: `apps/api/src/routes/family-join.ts` (all four endpoints),
`family_join_requests` collection accessor added to `db.ts`, `hashPassword`/
`User`/`AVATAR_COLORS`/`EMAIL_FORMAT_RE`/`getUsersCollection` exported from
`auth-users.ts` for reuse (no second, drifting password-hashing
implementation), `generateInviteCode`/`FamilyRole`/`FamilyMemberDoc`/
`FamilyGroupDoc` exported from `family-group.ts`, 4 new `AuditAction`
values. 14 tests in `family-join.test.ts` cover: the core safety property
(`POST /family/join` never creates a `users` row), the organizer-only
guard on every sensitive endpoint (confirmed 403 for a non-organizer
roster member and for an authenticated caller with no roster entry at
all), the full approve flow (real user created, added to the roster as
`role: 'adult'`, request removed), the email-registered-elsewhere race at
approval time, and invite-code reset. Full monorepo typecheck/lint/test
verified clean.

Frontend: `apps/web/src/app/invite/[code]/` (join form + pending-approval
state), `/invite` added to `AppShell`'s public-route allowlist, Settings
gained a "Join Requests" section (organizer-only, approve/deny) and a
"Reset invite code" action next to the existing invite-code display —
that existing display's UI copy ("lets a partner or caregiver join")
is now true rather than aspirational, exactly as this PRD's own framing
anticipated.

Not yet done, matching Out of scope exactly: no email delivery (the
requester is told to check back and sign in), no revocation of an already-
approved member's login on roster removal (flagged, not solved, in Out of
scope), `mode-context`'s persona toggle still unrelated to the
authenticated identity.
