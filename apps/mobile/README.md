# @lifekeel/mobile

Capacitor shell for the LifeKeel PWA. It loads `https://lifekeel.co.uk`
directly (`server.url` in `capacitor.config.ts`) — there is no bundled web
build to keep in sync, and the service worker inside the shell's webview
still caches the app shell for flaky/offline launches.

> **Note:** This package is intentionally outside the root Turbo graph.
> `pnpm build`, `pnpm test`, and `pnpm typecheck` do not run here. Use the
> `cd apps/mobile && pnpm …` commands below for mobile-specific work.

What the shell adds over the installed PWA:

- **Reliable iOS push** — `@capacitor/push-notifications` → APNs, where the
  PWA's web-push path can't reach.
- **Native camera capture** — `@capacitor/camera` via `src/lib/native.ts`
  on the upload screen (falls back to `<input capture>` in a browser).
- **Biometric unlock** — `@aparajita/capacitor-biometric-auth` (Face ID /
  Touch ID / Android biometric) gating app launch when the user enables it
  in Settings.

## First-time setup

```bash
cd apps/mobile
pnpm install
pnpm add:ios       # generates ios/ — requires Xcode on macOS
pnpm add:android   # generates android/ — requires Android Studio
pnpm sync
pnpm open:ios      # or open:android
```

The generated `ios/` and `android/` projects are gitignored — they're
build artifacts of `cap add`, not source. Native-side config that must
survive regeneration lives in `capacitor.config.ts` (plugin options) plus
the usual Xcode/Android settings noted below.

### iOS entitlements/Info.plist (after `cap add ios`)

- Push Notifications capability + `aps-environment` entitlement.
- `NSCameraUsageDescription` — e.g. "Scan documents into your family vault."
- `NSFaceIDUsageDescription` — biometric prompt reason.

### Android

- `google-services.json` (Firebase Cloud Messaging) into `android/app/`.
- `USE_BIOMETRIC` permission is declared by the plugin.
- Deep links: add `lifekeel.co.uk` App Links intent-filter when ready.

## How the web side talks to it

`apps/web/src/lib/native.ts` detects `window.Capacitor?.isNativePlatform()`
and dynamically imports the plugins — the packages are *not* web
dependencies, so the PWA bundle is unaffected; inside the shell the same
code paths upgrade to native behavior automatically.
