#!/usr/bin/env bash
# Regenerates the gitignored android/ project and applies the native config
# that can't live in capacitor.config.ts. Idempotent — safe in CI or locally.
# See docs/mobile-release.md for the one-time account/secrets setup.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p www
[ -f www/index.html ] || echo '<!doctype html><title>LifeKeel</title>' > www/index.html

[ -d android ] || pnpm run add:android
pnpm exec cap sync android

# FCM push — decoded by the workflow from GOOGLE_SERVICES_JSON. Optional until
# server-side push is wired; the build works without it.
if [ -n "${GOOGLE_SERVICES_PATH:-}" ] && [ -f "${GOOGLE_SERVICES_PATH}" ]; then
  cp "${GOOGLE_SERVICES_PATH}" android/app/google-services.json
  echo "google-services.json installed"
fi

# Brand icons + splashes into the generated res/ tree.
node scripts/apply-icons.mjs android

# Release signing — appended block merges into the generated build.gradle
# (Gradle merges repeated android/buildTypes blocks), so the gitignored
# project stays fully regenerable. Guarded so re-runs don't stack blocks.
if ! grep -q "prepare-android.sh" android/app/build.gradle; then
cat >> android/app/build.gradle <<'EOF'

// Release signing — appended by scripts/prepare-android.sh; reads CI env.
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "upload-keystore.jks")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
EOF
fi

# versionCode/Name — the generated template hardcodes 1/"1.0"; CI supplies
# BUILD_NUMBER/VERSION_NAME, locals get the defaults.
sed -i.bak "s/versionCode [0-9]*/versionCode ${BUILD_NUMBER:-1}/" android/app/build.gradle
sed -i.bak "s/versionName \"[^\"]*\"/versionName \"${VERSION_NAME:-0.1.0}\"/" android/app/build.gradle
rm -f android/app/build.gradle.bak

echo "Android project prepared: versionName ${VERSION_NAME:-0.1.0} versionCode ${BUILD_NUMBER:-1}"
