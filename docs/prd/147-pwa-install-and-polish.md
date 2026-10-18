# PRD-147: PWA install experience and manifest polish

## Problem

LifeKeel ships as a PWA plus a Capacitor shell. The install surface has gaps found in
review of `apps/web/public/manifest.json`: icons combine `any maskable` in one entry
(Android renders these poorly), there is no manifest `id`, no install screenshots,
and the service worker precaches every authenticated route even though API responses
are no longer cached (PR #62). iOS has no install prompt at all, and web push only
works for an installed PWA, so installation matters most on the platform that makes
it hardest.

## Who it's for

Phone, tablet and iPad users on the web, especially on iOS Safari.

## What "done" looks like

1. Separate `any` and `maskable` icon entries, a stable manifest `id`, and install
   screenshots for narrow and wide form factors.
2. An install hint that works under the strict CSP (no inline scripts): the Android and
   desktop install prompt where the browser offers one, and clear "Share → Add to Home
   Screen" guidance on iOS (`isIOS()` / `isStandalone()` in `lib/platform.ts`),
   shown at a useful moment and dismissible.
3. The service worker precache list trimmed to the public app shell; authenticated
   routes are cached on first visit only.
4. The theme colour and splash match both themes.
5. Lighthouse PWA checks pass on the production build for the home and reveal pages.
6. The native shell is unaffected.

## Constraints

- **Trust tier:** 0.
- **Regulated-advice check:** install copy contains no advice.
- **Data/privacy:** no new storage of personal data; the dismissal flag is a
  per-device preference.

## Builds on

`apps/web/public/manifest.json`, `apps/web/public/sw.js`, `apps/web/src/lib/platform.ts`,
PRD-140 (installed PWA is a push channel).

## Success metrics

Install rate by platform; share of iOS members with a working push channel
(PRD-140); no regression on first-load size.

## Out of scope

App Store or Play Store listing work, store review compliance for the native shell.

## Becomes

docs/prd/147-pwa-install-and-polish.md
