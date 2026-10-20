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

## Push notifications (PRD-140) — what you need to provide

The web app registers the device token (`subscribeNativePush` in `apps/web/src/lib/push.ts`)
and the API sends through FCM (`apps/api/src/delivery/fcm-sender.ts`). **None of this has
been tested on a real device or against a real Firebase project.** It does nothing until
these are in place:

1. **Firebase project** with Cloud Messaging enabled, and a service-account key
   (Firebase console → Project settings → Service accounts). Set the whole JSON as
   `FCM_SERVICE_ACCOUNT_JSON` on the API (Cloud Run secret). Without it the API never
   selects the FCM sender.
2. **Android:** add the app in Firebase and put `google-services.json` in the generated
   `android/app/` after `pnpm add:android`.
3. **iOS:** an APNs key (Apple developer account → Keys) uploaded to Firebase; the Push
   Notifications capability and `aps-environment` entitlement in the generated Xcode
   project; and the Firebase iOS SDK added to the shell (for example the
   `FirebaseMessaging` pod), so the plugin returns an FCM token rather than a raw APNs
   token. A raw APNs token cannot be used by the FCM sender.
4. Test on a physical device. The iOS Simulator cannot receive remote push.

A push shows on lock screens, so it carries only a generic title, a generic body and a
deep link: never amounts, names or providers. On sign-out the app unregisters the token.

## How the web side talks to it

`apps/web/src/lib/native.ts` detects `window.Capacitor?.isNativePlatform()`
and dynamically imports the plugins — the packages are *not* web
dependencies, so the PWA bundle is unaffected; inside the shell the same
code paths upgrade to native behavior automatically.

## Regions (`.co.uk` / `.si`)

Accounts and sessions are per registrable domain, but `server.url` is fixed at
build time, so the shell always starts on `app.lifekeel.co.uk`. Inside the shell,
`apps/web`'s `NativeRegionGate` (mounted in `app/layout.tsx`) then redirects to the
user's region host (`apps/web/src/lib/region.ts`):

- No prompt on first launch: the region is guessed from the device language
  (`sl-SI` → Slovenia, anything else → United Kingdom) and saved. An install that
  already has a session on `.co.uk` is saved as UK and never moved.
- The choice is stored in the native **Preferences** plugin (key `lifekeel_region`),
  not localStorage, so WebView storage eviction can't lose it. Signing out does not
  clear it.
- `Region: … · Change` (`RegionSwitch`) on login, signup and Settings corrects a
  wrong guess with one tap.
- `allowNavigation` must keep both app hosts, or the redirect opens in Safari.

**Not covered by automated tests:** that the Capacitor bridge and Preferences plugin
are present on the `.si` page after the cross-origin redirect. Check it by hand in
the iOS Simulator with the device region set to Slovenia before shipping a build.
