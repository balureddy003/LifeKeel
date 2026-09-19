# Mobile apps + web distribution analysis (2026-09-19)

A point-in-time analysis answering: what does it actually take to offer
Agent Oak as native iOS/Android apps alongside the existing web app?
Grounded in the real codebase (every "already built" claim below was
checked against code, not assumed) — not a market survey. Findings that
warrant engineering work should graduate into a numbered PRD under
`docs/prd/` per this folder's convention.

## Headline: Agent Oak is already ~85% a mobile app

`apps/web` isn't a desktop web app that would need a mobile variant —
it's a mobile-first installable PWA whose remaining distance to "app" is
mostly *distribution*, not capability:

- **PWA infrastructure, shipped**: `apps/web/public/manifest.json` has
  `display: standalone`, maskable icons, shortcuts, `handle_links`, and
  `launch_handler`; `apps/web/public/sw.js` implements offline-first
  caching (app shell stale-while-revalidate, API network-first, static
  cache-first), push notification handling, and background sync;
  `AppShell.tsx`'s `PwaInit` registers it, and the unread inbox count is
  mirrored onto the installed app's icon badge via `setAppBadge`.
- **Mobile-native UI patterns, shipped**: bottom tab bar below `md`
  (`LiquidTabBar`) swapped for a desktop `NavRail` above it, plus
  `PullToRefresh`, `SwipeableRow`, `BottomSheet`, haptics, safe-area
  padding, and an offline banner — all in `apps/web/src/components/`.
- **Offline writes, shipped**: `src/lib/offline-queue.ts` persists
  failed mutations to IndexedDB and replays them on reconnect with a
  confirmation toast — the "a dead connection shouldn't lose a write"
  property a family-safety product needs.
- **Camera document capture, shipped**: `app/upload/page.tsx` already
  uses `capture="environment"` — mobile document scanning works in a
  phone browser today.
- **Web push, end to end**: `apps/api/src/routes/push.ts` (VAPID
  subscribe/unsubscribe) plus `DeliveryRouter`'s urgency floor, quiet
  hours, and dedup.
- **Server-side mobile push plumbing already exists**:
  `apps/api/src/delivery/channels.ts`'s `RealMobilePushSender` speaks
  Expo's push API (`exp.host`), and `DeliveryRouter` exposes
  `saveMobilePushToken`/`enableMobilePush` — inherited from kairos-ai's
  Studio app. The registration surface it was missing shipped
  2026-09-19: `POST /push/mobile/subscribe` and
  `POST /push/mobile/unsubscribe` in `routes/push.ts`.

Two honest counterweights before the options:

1. **A native app isn't required for the core promise.** `DeliveryRouter`
   already falls back WhatsApp → SMS → Email. "Oak reaches you when it
   matters" works without any app install; native push adds one more
   (cheap, reliable) channel, it doesn't unblock a missing capability.
2. **The Expo sender is a hint, not a directive.** It only means the
   parent monorepo once had an Expo client. Nothing about it argues for
   rewriting this frontend — see Option C.

## The three options

| | PWA only (today) | Capacitor wrap | React Native / Expo rewrite |
|---|---|---|---|
| Engineering effort | Small (verify + polish) | Medium | Large |
| Codebases | 1 | 1 | 2 |
| Store presence | No (Android possible via TWA) | Yes | Yes |
| Native push | iOS: installed PWA only (16.4+) | APNs/FCM | APNs/FCM |
| UX ceiling | Already high | Same web UX + native bridge | Highest (widgets, biometrics, HealthKit) |
| What it buys | Everything except the listing | The listing + native push | Native-only features |

**Option A — PWA only.** Zero new architecture. The real gaps: no App
Store listing (discoverability, the trust signal of a reviewed app);
iOS push requires the user to have installed the PWA first (manual
"Add to Home Screen" — no install prompt exists on iOS Safari); Android
install prompts work but there's no custom install UX yet. Work here is
verification and polish, not new systems.

**Option B — Capacitor wrap (the pragmatic store path).** Wrap the
existing static export in a native shell: one codebase, real store
listings, native push via `@capacitor/push-notifications` or the Expo
sender the API already speaks. The gaps below are all solvable; none
are free.

**Option C — React Native/Expo rewrite.** Not justified at current
scale. Agent Oak's differentiators — the detector engine, the grounded
assistant, the playbooks — are all server-side; the client is a
rendering surface, and rewriting it buys nothing for the moat while
creating a second frontend to keep in parity. Revisit only if
native-only features become load-bearing (home-screen widgets,
biometric unlock, HealthKit for the health domain in ARCHITECTURE.md's
roadmap step 4).

## Gaps a Capacitor wrap surfaces (the real cost)

1. **Google OAuth inside a webview is blocked.** `signInWithProvider`
   (`auth-context.tsx`) does a full-page `window.location` redirect to
   `/auth/google/login?app=family`; Google refuses OAuth inside
   WKWebView. The fix is standard: open the flow in the system browser
   (ASWebAuthenticationSession on iOS, Chrome Custom Tab on Android) and
   deep-link back — `/auth/callback#token=` is already the right
   handoff shape, no new API surface needed.
2. **Sign in with Apple becomes mandatory.** App Store review
   guideline 4.8: offering Google sign-in requires offering Apple
   sign-in too. That's a new OAuth provider in `auth-social.ts` plus
   Apple developer account plumbing — small but not optional.
3. **Oak Plus billing hits the IAP rules — the largest non-engineering
   cost.** Oak Plus (£7.99/mo, real Stripe price id in
   `billing-constants.ts`) is a digital subscription. Inside a native
   iOS shell, Apple expects in-app purchase (15–30% commission) unless
   the app qualifies for and implements an external-purchase-link
   entitlement (available in some regions, with its own review and
   disclosure requirements) or keeps purchase web-only. Google Play's
   financial-services policies have their own version. This is a
   margin/business decision that shapes the code — decide it before
   writing the wrapper, not after. `upgrade/page.tsx`'s
   `window.location.href = stripeCheckoutUrl` also can't stay as-is in a
   webview regardless of which billing answer is chosen.
4. ~~**Mobile push token registration route.**~~ Done (2026-09-19):
   `POST /push/mobile/subscribe` + `/push/mobile/unsubscribe`, with
   `disableMobilePushIfNoTokens` added to the router for parity with web
   push.
5. **Universal links / Android App Links** for `/invite` codes and push
   action URLs. The invite code is the growth loop (PRD-110/112); a
   tap on an invite link that lands in a browser instead of the
   installed app loses the loop's best moment.
6. **Token storage reconsideration.** `agentoak_token` in `localStorage`
   survives inside WKWebView (same WebKit data store), so this isn't a
   blocker — but SECURITY.md already flags localStorage bearer tokens
   as the deferred correct fix (httpOnly cookie), and a native wrapper
   is the natural moment to do it since cookie-vs-bearer affects both
   surfaces at once.
7. **Store review overhead, ongoing**: Apple privacy nutrition labels
   (document uploads + household financial data is a heavy disclosure
   surface), Google Play financial-services declarations, signing
   certs, release channels, and a review cycle that doesn't exist for
   Firebase static deploys today.

## Product-strategy notes

- **Emergency Mode is the strongest argument for a real icon.** The
  scenario where Oak matters most — a family member in crisis, on a
  phone, under stress — is exactly where "search the app store, it's
  reviewed, it's on my home screen" beats "remember the URL." This is a
  distribution argument, not a capability one.
- **The trust-tier model survives mobile unchanged.** Nothing about a
  native shell raises the ceiling on what Oak may do autonomously — a
  Capacitor wrap doesn't move anything past Tier 1. If anything, App
  Store review of an "autonomous agent" product makes the
  prepare-not-send story *more* valuable: it's the answer to "what does
  this app do on the user's behalf?"
- **CLAUDE.md's second rule applies to store listings too.** The
  informational-not-advice positioning that keeps Oak out of FCA/SEC
  territory also shapes how it clears the stores' own financial-app
  review categories — app-store copy should stay on the same side of
  that line as insight copy does.
- ~~**Naming drift cleanup first.**~~ Done (2026-09-19): `sw.js`'s
  header comment, cache names, notification fallback title, and
  notification tag now say "Agent Oak" throughout. The
  `family-offline`/`pendingActions`/`sync-family-actions` IndexedDB
  identifiers were deliberately left — renaming them would strand queued
  writes in installed PWAs and collide with `offline-queue.ts`'s
  `agentoak-offline` DB; they're internal names, invisible to users.

## Recommendation

1. **Phase 1 — ship the PWA deliberately (near-free).** Verify iOS
   16.4+ installed-PWA push end-to-end, add a custom install prompt
   where the platform allows one, fix the `sw.js` naming drift. Result:
   an installable app on every platform today, no new infra.
2. **Phase 2 — Capacitor wrap when store presence earns its cost.**
   Scope the PRD as: native shell + OAuth-in-system-browser + universal
   links + `POST /push/mobile` + the IAP decision (which must precede
   the build, since it determines what `upgrade` can show in-app). The
   trigger is a distribution need — families who won't install a PWA,
   or push reliability that the WhatsApp/SMS/email fallback doesn't
   adequately cover.
3. **Phase 3 — RN/Expo only for native-load-bearing features.** Widgets,
   biometrics, HealthKit — none are on the roadmap yet; don't pay for a
   second frontend before one is.

## What would graduate to a PRD

Phase 1 is small enough to be a remediation-style fix list rather than a
PRD. Phase 2 is the PRD candidate — naturally numbered **PRD-114+
(mobile distribution via Capacitor)**, Tier 0/1 unchanged (it's a
delivery surface, not a new action), with the IAP/billing decision
called out as a named prerequisite the way PRD docs name trust tiers.
