# PRD-112: friend referral loop

## Problem

PRD-110's `invite_code` (per-family, organizer-approval-gated) is
deliberately scoped to adding a real household member to an existing
family — reusing it for growth would mean loosening a trust gate that
was a considered decision, not an oversight. Nothing today lets an
existing family invite a *friend* — someone starting their own,
completely separate LifeKeel account — the standard "invite a friend"
growth loop every fintech in
[competitive-differentiation-deep-dive-2026.md](../reviews/competitive-differentiation-deep-dive-2026.md#angle-5--distribution-the-invite-code-is-already-a-growth-loop-not-just-an-access-mechanism)'s
research runs. There's no shareable referral link, no attribution, no
reward.

## Market bar

Referral-program research is consistent: one-tap invites with rewards
conditioned on the invitee completing a real action (not just installing)
outperform install-based rewards and are the lowest-CAC channel in the
category — see the deep-dive doc's Angle 5. Dropbox's referral program is
the canonical example (100k → 4M users in 15 months via a conditional,
two-sided reward).

## Who it's for

An existing LifeKeel family who wants to tell a friend about it — not a
household member, a genuinely separate family who'd get their own
account. The reward should make that one tap worth taking, for both
sides.

## What "done" looks like

Every tenant has a personal referral code (lazily generated, same
collision-retry shape as `generateInviteCode()` in
[family-group.ts](../../apps/api/src/routes/family-group.ts), reused
directly rather than reimplemented). A referral link
(`/signup?ref=<code>`) captured at signup attributes the new tenant to
the referrer. When the referred tenant completes their first meaningful
action — their first `generate_insights: true` financial-profile submit,
the same milestone PRD-111 and the existing onboarding-completeness logic
already treat as "real use has started," not just an account existing —
**both** tenants are credited, using the exact atomic
insert-redemption-then-$inc-balance-then-ledger-entry sequence
[promo-codes.ts](../../apps/api/src/billing/promo-codes.ts)'s
`redeemPromoCode` already implements (reused, not reinvented). Reward
size: 25 credits each, matching the smallest existing credit pack
(`pack_25`) as a sane default. A Settings surface shows the family's own
referral link and a simple count of friends who've joined and been
rewarded.

## Trust tier

**Tier 0 — Observe/Understand/Predict**, with one Tier-1-adjacent
exception scoped narrowly: crediting an internal app currency (AI-
extraction credits) is not a financial transaction — it's the same
mechanism `redeemPromoCode` already performs unattended today, with no
approval gate on that path either. No real money moves, no external
provider is called, nothing here is reversible-with-consequence the way
a Stripe charge would be. This stays consistent with CLAUDE.md's trust-
tier rule (irreversible *financial* actions need a human gate; an
in-app credit grant, already precedented, doesn't rise to that bar).

## Scope

1. **Referral code** — a new `referral_codes` collection (`{tenant_id,
   code, created_at}`, unique index on `code`), generated lazily on first
   request via the existing `generateInviteCode()` helper.
   `GET /referrals/my-code` returns (creating if absent) the caller's
   code.
2. **Attribution** — signup accepts an optional `ref` field; if it
   resolves to a real referral code, insert a `referrals` doc
   (`{referrer_tenant_id, referred_tenant_id, code, status: 'pending',
   created_at}`) at account-creation time. A self-referral (the code
   resolves to the same tenant that's signing up — not possible at
   signup since the tenant doesn't exist yet, but worth a defensive
   check) and an already-attributed tenant are both no-ops, not errors.
3. **Reward on meaningful action** — in the financial-profile save path
   (the same `generate_insights: true` gate PRD-111 uses), if this is the
   tenant's *first* such submit and a pending `referrals` doc exists for
   them, mark it `rewarded` and credit both tenants 25 credits each via
   the same atomic sequence `redeemPromoCode` uses (insert-then-$inc-
   then-ledger-entry) — extracted into a small shared helper rather than
   copy-pasted, since the sequence is genuinely identical.
4. **`GET /referrals`** — the caller's own referral history (counts of
   pending/rewarded), for the Settings surface.
5. **Frontend**: a "Refer a friend" row in Settings showing the link/code
   with a copy action and the reward counts; `/signup` reads `?ref=` from
   the URL (same `window.location.search` convention as `/life-events`'s
   `?type=` and `/financial-profile`'s `?step=`) and passes it through to
   `signUp()`.

Out of scope: any reward larger than in-app credits (no cash, no Stripe
interaction of any kind — keeps this fully inside the Tier-0-adjacent
reasoning above); a leaderboard or social-proof surface around referral
counts (worth considering later, not needed to close this gap);
retroactively attributing existing accounts that signed up before this
shipped.

## Success metrics

- **Referral → signup conversion**: link opens vs. completed signups
  with a valid `ref` attribution.
- **Signup → reward conversion**: attributed signups vs. those that
  reach the first-profile-submit milestone and actually get rewarded —
  the real "did this loop actually work" signal, not just link clicks.
- **Zero double-rewards**: the same referred tenant is never credited
  twice, even under concurrent submit requests — enforced the same way
  `redeemPromoCode`'s unique-index-as-atomic-guard already enforces it
  for promo codes.

## Acceptance criteria

- A tenant's `GET /referrals/my-code` returns the same code on every
  call (idempotent generation, not a new code per request).
- Signing up with a valid `?ref=` code creates a `pending` referral doc
  attributing the new tenant to the referrer; an invalid or missing code
  creates none, and signup still succeeds either way.
- The referred tenant's first `generate_insights: true` submit — and
  only the first — transitions the referral to `rewarded` and credits
  both tenants exactly once each; a second submit does not re-reward.
- A concurrent double-submit race on the first save rewards the referral
  exactly once, not twice (regression test mirroring `redeemPromoCode`'s
  existing duplicate-redemption guard).
- The Settings referral row never appears for a tenant with no
  `family_groups` entry in a state that would make sharing it confusing
  (matches the same guard PRD-110's own invite-code row already applies).

## Implementation status — 2026-09-19

Shipped, matching this PRD's scope. `referrals.ts` reuses
`generateInviteCode()` and the exact atomic redeem-then-credit-then-
ledger sequence `promo-codes.ts` already implements (extracted into
`creditTenant()`, called for both the referrer and referee). Signup's
`ref` field is deliberately separate from the existing, unrelated
`invite_code` concept (a platform-wide B2B gate) — see the code comment
at the point they'd otherwise be confused. The reward trigger reuses
PRD-111's `previousDoc` read (`!previousDoc` = first-ever submit) rather
than adding a second history mechanism. 9 backend tests cover code
idempotency, attribution (valid/invalid/missing/duplicate), and the
reward path including a genuine concurrent-double-submit race — verified
passing, not just asserted. Full gate clean: typecheck, lint, web and
API tests all green.
