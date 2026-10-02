# PRD-123: per-member invite flow

## Problem

PRD-110 gave families a second real login — but only through a shared
invite code and a join-request queue: a stranger presents the family
code, the organizer approves, and approval *appends a brand-new active
roster row*. A member the organizer already added stays `pending`
forever, and approving their join request created a **duplicate** roster
entry for the same human — the pending row kept its own `id` (which
member twins, attributed insights, and earner records already reference)
while the new active row got a different one.

## Who it's for

Organizers who added a family member by name and want that specific
person to join — and the invitee, who gets a one-time link that lands
them signed in with everything already on file.

## What "done" looks like

- `POST /family/members/:id/invite` (organizer-only, rate-limited):
  validates the member is `pending` and not `role: 'child'` (minors
  never get credential-bearing logins — their twin is managed by the
  adults). Email comes from the roster entry or the request body
  (persisted to the member when supplied). Creates a `family_member_invites`
  doc: bearer token (48-hex), 7-day expiry, one outstanding invite per
  member (re-inviting rotates the token). Sends via
  `sendFamilyInviteEmail` — the SendGrid helper pattern from password
  reset: no API key → silent no-op, and the response still carries
  `invite_url` so the organizer can share it manually. Token never lands
  in logs or audit metadata.
- `GET /family/invite/:token` (public, rate-limited): resolves the token
  to `{member_name, family_name, expires_at}` for the accept page —
  never the email, never anything financial.
- `POST /family/invite/accept` (public, rate-limited): verifies the
  token, then either creates a `users` row (`viewer` role, the invite's
  tenant) or verifies the password against an existing **same-tenant**
  account (the token claims the roster entry; the password proves the
  account). Cross-tenant email → 409. Then flips the *existing* member
  `pending → active`, sets `user_id`, preserves `id`, role, DOB, name.
  Invite deleted on use; expired/used/activated-member tokens all reject.
  Returns a signed session token so the acceptor lands logged in.
- **Linking model**: `member.id` stays the stable roster identity;
  `member.user_id` is the auth link added at acceptance. New
  `memberMatchesUser()` in `family-permissions.ts` matches on either —
  applied to `isFamilyAdult`, `isFamilyOrganizer`, the join routes'
  `requireOrganizer`, and `vault-reminder`.
- **Approve path fixed**: `/family/access-requests/:id/approve` now
  activates a pending roster entry matched by email instead of pushing a
  duplicate row.
- Open-route allowlist: `/family/invite/` (trailing slash — deliberately
  does NOT match the organizer-only `/family/invite-code/reset`).
- Web: `/invite/[code]` distinguishes a 48-hex invite token from the
  6-char join code and renders the accept flow (`useAuth().acceptFamilyInvite`
  stores the session like signIn). The member page's pending card gets a
  real "Email invite" action with an email field when the roster entry
  has none, and shows the copyable link when email isn't configured.

## Acceptance criteria

- [x] Organizer can invite a pending non-child member; child members → 400,
      already-active → 409, unknown → 404, non-organizer → 403.
- [x] Re-inviting rotates the token (one outstanding invite per member).
- [x] Accept creates a user, flips the existing entry active, links
      `user_id`, consumes the token, returns a session — roster stays
      deduplicated (`id` unchanged).
- [x] Existing same-tenant account links on password verify; wrong
      password → 401 without consuming the invite; cross-tenant email → 409
      at both invite and accept.
- [x] Expired/unknown/activated-member tokens reject on both lookup and
      accept.
- [x] No token in audit metadata or logs.
- [x] Audit events: `family.member_invited`, `family.member_invite_accepted`.
- [x] 27 tests green in `family-join.test.ts`; api + web typecheck clean.
