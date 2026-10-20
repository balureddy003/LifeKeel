# Mobile store releases

`apps/mobile` is a thin Capacitor shell over the deployed PWA — most app updates
ship through `deploy-web.yml` with no store release at all. A store build is only
needed when the **shell itself** changes: `capacitor.config.ts`, plugin versions,
entitlements, icons, or store metadata.

Pipeline: `.github/workflows/release-mobile.yml` — `workflow_dispatch` only,
main-only guard (same model as `deploy-web.yml`). iOS builds on `macos-15`
with fastlane → TestFlight; Android builds on `ubuntu-latest` → Play track.

## Cost model

- Runner minutes: free (public repo). The workflow is dispatch-only so nothing
  runs by accident.
- Tooling: fastlane + App Store Connect API key signing — no paid service, no
  fastlane `match` certs repo (Xcode auto-manages signing with the API key).
- Ongoing human steps: Apple Developer ($99/yr) and Play Console ($25 once)
  accounts, store metadata/screenshots (done in the consoles, not the pipeline).

## One-time setup — iOS (~30 min, needs the Apple account)

1. **App ID**: developer.apple.com → Identifiers → register `uk.co.lifekeel.app`
   with the **Push Notifications** capability.
2. **App Store Connect**: create the app (iOS, `uk.co.lifekeel.app`).
3. **API key**: App Store Connect → Users and Access → Integrations → App Store
   Connect API → generate a key (Developer role suffices for TestFlight) and
   download the `.p8`.
4. **Repo secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `ASC_KEY_ID` | Key ID from step 3 |
   | `ASC_ISSUER_ID` | Issuer ID shown above the keys table |
   | `ASC_KEY_P8` | `base64 -i AuthKey_XXXX.p8` output |
   | `APPLE_TEAM_ID` | 10-char Team ID (developer.apple.com → Membership) |

## One-time setup — Android (~30 min, needs the Play account)

1. **Play Console**: create the app (package `uk.co.lifekeel.app`), enable
   **Play App Signing** (Google holds the release key — you keep an upload key).
2. **Upload keystore** (once, keep the file safe — losing it means contacting
   Play support to reset):
   ```bash
   keytool -genkeypair -v -keystore upload-keystore.jks \
     -alias lifekeel-upload -keyalg RSA -keysize 2048 -validity 10000
   ```
3. **Service account**: Google Cloud → link project to Play Console → create a
   service account with the "Release manager" role → JSON key.
4. **FCM** (needed once push goes live): Firebase project for the package →
   `google-services.json`.
5. **Repo secrets**:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | `base64 -i upload-keystore.jks` |
   | `ANDROID_KEYSTORE_PASSWORD` | keystore password |
   | `ANDROID_KEY_ALIAS` | `lifekeel-upload` |
   | `ANDROID_KEY_PASSWORD` | key password |
   | `PLAY_SERVICE_ACCOUNT_JSON` | `base64 -i service-account.json` |
   | `GOOGLE_SERVICES_JSON` | `base64 -i google-services.json` (optional until FCM push) |

## Releasing

Actions → **Release mobile** → Run workflow (from `main`) → pick platform,
`version_name`, and Android track. `build_number`/`versionCode` defaults to the
run number. Artifacts (`.ipa`/`.aab`) are attached to every run for manual
upload if the store upload step is skipped or fails.

Both stores require a **human publish** the first time — internal track and
TestFlight are automatic thereafter. Store metadata, screenshots, and privacy
declarations are maintained in the consoles, not in this repo.

## Manual QA gate (from apps/mobile/README, not automated)

Before the first release and after any `server.url`/region change: iOS
Simulator, device region **Slovenia** → the shell must land on
`app.lifekeel.si` with the Capacitor bridge and Preferences plugin intact
(`NativeRegionGate` / `lifekeel_region`).

## What the pipeline deliberately does not do

- **No automatic releases on merge** — same reason as `deploy-web.yml`:
  human-gated on purpose.
- **No screenshot/metadata automation** (`deliver`/`supply` metadata upload is
  disabled) — one-time console work, not worth the brittleness.
- **No `match`/certs repo** — `-allowProvisioningUpdates` handles signing from
  the ASC API key.
- **No EAS/Codemagic/etc.** — fastlane + runners are $0.
