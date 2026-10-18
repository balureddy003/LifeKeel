# PRD-140: Notification channel fallback across web, installed PWA and native shell

## Problem

The product runs as a PWA on web, phone and tablet, and inside a Capacitor shell
(apps/mobile). Push does not work the same everywhere: iOS only supports web push
from an **installed** PWA (`apps/web/src/lib/platform.ts` documents this), the shell
can use APNs and FCM, and many users will have neither. The heartbeat is
email-only today because the push channel speaks only `InsightNotification`
(`family-heartbeat.ts` header). Without a defined fallback a user on the wrong
device silently gets nothing.

## Who it's for

Every member on iPhone, iPad, Android, desktop browser, or the native shell.

## What "done" looks like

1. For each member the system picks the best available channel in order:
   native push (shell), web push (installed PWA with permission), email.
   The digest (PRD-138) always has email as a floor.
2. A member's channel state (which are registered, which failed) is visible in
   settings, with a one-line explanation when push is unavailable, for example "add to
   Home Screen to get alerts on iPhone".
3. A failed push (expired subscription, revoked permission) falls back to email for
   Tier A messages and is recorded, so a dead device does not mean lost alerts.
4. Push payloads carry **no financial content**: a generic title and a deep link
   only, because they appear on lock screens, including on shared devices.
5. `mobile_push` (already in the channel type union) is implemented for the shell
   using the existing Capacitor push plugin and `apps/web/src/lib/native.ts`.
6. The heartbeat and digest gain a push-shaped payload so they can use channels
   beyond email.

## Constraints

- **Trust tier:** 0.
- **Regulated-advice check:** push text is generic; it never contains advice.
- **Data/privacy:** device tokens are per-tenant, deleted on sign-out and account
  deletion (PRD-146). Never put amounts, names of policies, or provider names in
  a push payload.

## Builds on

`apps/api/src/delivery/web-push-sender.ts`, `apps/web/src/lib/push.ts`,
`apps/web/src/lib/platform.ts`, PRD-139 (tiers and caps).

## Success metrics

Share of Tier A messages delivered on a first channel; share of members with at
least one working channel; fallback rate by platform.

## Out of scope

SMS and WhatsApp changes; marketing push.

## Open questions

APNs and FCM credentials and entitlements are deploy and store-account work that
needs the user's accounts; list them in the implementation plan rather than assuming.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Permission journey.** Define when to ask: a soft in-app prompt before the system
   prompt, never on first launch; denied-state recovery steps; Android 13 runtime
   permission timing. `subscribeToPush` currently prompts directly.
2. **Lock-screen exposure includes email.** Subject lines and previews carry no
   financial words, as push payloads must not.
3. **Per-channel table** of legal basis, opt-out mechanism and consent record (push,
   email, in-app) before launch. Counsel to confirm PECR treatment of service
   messages.
4. **Scope option:** the competitive review suggests trimming v1 to web push plus
   email. Native push can follow; see the review's decisions list.
5. **Evidence note:** the claim that iOS web push needs an installed PWA comes from
   secondary guides, with no Apple primary source found; re-verify before relying on
   it.

## Becomes

docs/prd/140-notification-channel-fallback.md
