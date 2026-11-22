#!/usr/bin/env bash
# One-time iOS release setup: stores the four App Store Connect secrets on the
# repo so Actions → Release mobile can ship to TestFlight. Run it yourself; it
# prints no secret. It cannot do the Apple steps, which need your Apple account
# (docs/mobile-release.md, iOS steps 1 to 3): register the App ID with Push,
# create the app in App Store Connect, and generate the API key (.p8).
#
# Usage: scripts/setup-ios-release.sh /path/to/AuthKey_XXXX.p8 KEY_ID ISSUER_ID TEAM_ID
set -euo pipefail

P8="${1:-}"; KEY_ID="${2:-}"; ISSUER="${3:-}"; TEAM="${4:-}"
if [ ! -f "$P8" ] || [ -z "$KEY_ID" ] || [ -z "$ISSUER" ] || [ -z "$TEAM" ]; then
  echo "Usage: $0 /path/to/AuthKey_XXXX.p8 KEY_ID ISSUER_ID TEAM_ID" >&2; exit 2
fi
command -v gh >/dev/null || { echo "Needs the GitHub CLI (gh), signed in." >&2; exit 2; }
[[ "$TEAM" =~ ^[A-Z0-9]{10}$ ]] || { echo "TEAM_ID should be 10 letters/digits." >&2; exit 2; }
grep -q "BEGIN PRIVATE KEY" "$P8" || { echo "$P8 does not look like a .p8 key." >&2; exit 2; }

REPO="${REPO:-balureddy003/LifeKeel}"
printf '%s' "$KEY_ID" | gh secret set ASC_KEY_ID --repo "$REPO"
printf '%s' "$ISSUER" | gh secret set ASC_ISSUER_ID --repo "$REPO"
printf '%s' "$TEAM" | gh secret set APPLE_TEAM_ID --repo "$REPO"
base64 < "$P8" | tr -d '\n' | gh secret set ASC_KEY_P8 --repo "$REPO"

echo "Secrets stored on $REPO."
echo "Next: Actions → Release mobile → platform ios, web_url = the staging URL."
