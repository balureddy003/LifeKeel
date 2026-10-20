#!/usr/bin/env bash
# Regenerates the gitignored ios/ project and applies the native config that
# can't live in capacitor.config.ts. Idempotent — safe to run locally or in CI.
# See docs/mobile-release.md for the one-time account/secrets setup.
set -euo pipefail
cd "$(dirname "$0")/.."

# webDir placeholder — required by `cap sync`, never served (server.url wins).
mkdir -p www
[ -f www/index.html ] || echo '<!doctype html><title>LifeKeel</title>' > www/index.html

[ -d ios ] || pnpm run add:ios
pnpm exec cap sync ios

PB=/usr/libexec/PlistBuddy
PLIST="ios/App/App/Info.plist"

# Usage strings the plugins need — no defaults, required at review/run time.
set_plist_string() {
  local key="$1" value="$2"
  $PB -c "Add :${key} string ${value}" "$PLIST" 2>/dev/null \
    || $PB -c "Set :${key} ${value}" "$PLIST"
}

# NB: PlistBuddy's -c parser treats ' as a quote char — keep values apostrophe-free.
set_plist_string NSCameraUsageDescription "Scan documents into your family vault."
set_plist_string NSFaceIDUsageDescription "Unlock LifeKeel to see your family data."
set_plist_string CFBundleShortVersionString "${VERSION_NAME:-0.1.0}"
set_plist_string CFBundleVersion "${BUILD_NUMBER:-1}"

# Push entitlement — the Fastfile points CODE_SIGN_ENTITLEMENTS at this file,
# which avoids editing the generated .pbxproj. The App ID must have Push
# enabled (one-time portal step, or Xcode automatic signing adds it).
mkdir -p ios/App/App
cat > ios/App/App/App.entitlements <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>aps-environment</key>
  <string>production</string>
</dict>
</plist>
EOF

echo "iOS project prepared: version ${VERSION_NAME:-0.1.0} (${BUILD_NUMBER:-1})"
