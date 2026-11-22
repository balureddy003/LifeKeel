#!/usr/bin/env bash
# One-time Android release setup: makes the upload keystore and stores the
# Play secrets on the repo, so Actions → Release mobile can ship to Play.
#
# Run it yourself on your machine. It never prints a secret. Back up the
# keystore file it writes: losing it means asking Play support to reset the
# upload key. It cannot do the Play Console steps, which need your Google
# account: create the app, turn on Play App Signing, and make the service
# account (docs/mobile-release.md, Android steps 1 and 3).
#
# Usage: scripts/setup-android-release.sh /path/to/play-service-account.json
set -euo pipefail

SA_JSON="${1:-}"
[ -f "$SA_JSON" ] || { echo "Usage: $0 /path/to/play-service-account.json" >&2; exit 2; }
command -v gh >/dev/null || { echo "Needs the GitHub CLI (gh), signed in." >&2; exit 2; }
command -v keytool >/dev/null || { echo "Needs a JDK (keytool)." >&2; exit 2; }

REPO="${REPO:-balureddy003/LifeKeel}"
ALIAS="lifekeel-upload"
KS="${KEYSTORE_OUT:-$HOME/lifekeel-upload-keystore.jks}"
[ ! -e "$KS" ] || { echo "$KS already exists; refusing to overwrite it." >&2; exit 1; }

PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
keytool -genkeypair -v -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 2048 \
  -validity 10000 -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=LifeKeel, O=LifeKeel, C=GB" >/dev/null 2>&1

b64() { base64 < "$1" | tr -d '\n'; }
printf '%s' "$(b64 "$KS")" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
printf '%s' "$PASS" | gh secret set ANDROID_KEY_PASSWORD --repo "$REPO"
printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
printf '%s' "$(b64 "$SA_JSON")" | gh secret set PLAY_SERVICE_ACCOUNT_JSON --repo "$REPO"

echo "Secrets stored on $REPO. Keystore: $KS (back it up; the password lives only in the repo secret)."
echo "Next: Actions → Release mobile → platform android, track internal, web_url = the staging URL."
