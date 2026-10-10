#!/usr/bin/env bash
# Checks that the LifeKeel domains are mapped correctly. Safe to run any time (read-only), from any machine
# with curl (macOS bash 3.2 compatible; DNS is read over HTTPS from dns.google, so no dig needed).
#
#   scripts/check-domains.sh                       # website + email records
#   API_URL=https://your-api.run.app scripts/check-domains.sh   # also checks the API and CORS
#
# Canonical site: https://lifekeel.co.uk. Everything else must redirect there. See docs/domains.md.
set -u
CANON="${CANON_HOST:-lifekeel.co.uk}"
HOSTS="lifekeel.co.uk www.lifekeel.co.uk lifekeel.si www.lifekeel.si"
fails=0; warns=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "        -> $2"; fails=$((fails+1)); }
warn() { echo "  WARN  $1"; [ -n "${2:-}" ] && echo "        -> $2"; warns=$((warns+1)); }
doh() { curl -s -m 10 "https://dns.google/resolve?name=$1&type=$2" | grep -o '"data":"[^"]*"' | sed 's/"data":"//; s/"$//'; }

echo "== Website: every name must end up at https://$CANON (served by Firebase, not the parking page)"
for h in $HOSTS; do
  echo " $h"
  a="$(doh "$h" A | tr '\n' ' ')"
  [ -n "$a" ] && echo "        A: $a" || echo "        A: (none)"
  body="$(curl -s -m 20 -L "https://$h/" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -qi "Parked Domain"; then
    fail "$h still shows the Hostinger parking page" "add the Firebase records in hPanel > Domains > DNS zone, remove the parking A record (see docs/domains.md)"; continue
  fi
  [ -n "$body" ] || { fail "$h did not answer over HTTPS" "DNS not pointing at Firebase yet, or its certificate is still being issued (can take up to a day)"; continue; }
  eff="$(curl -s -m 20 -o /dev/null -L -w '%{url_effective}' "https://$h/" 2>/dev/null)"
  case "$eff" in "https://$CANON"*) pass "$h ends at $CANON" ;; *) fail "$h ends at $eff, expected https://$CANON/" "set the redirect to $CANON in the Firebase custom-domain wizard" ;; esac
  if [ "$h" != "$CANON" ]; then
    first="$(curl -s -m 20 -o /dev/null -w '%{http_code}' "https://$h/" 2>/dev/null)"
    case "$first" in 301|302|307|308) pass "$h redirects ($first)" ;; *) fail "$h returned $first, expected a redirect" "enable 'redirect to $CANON' for this domain in Firebase" ;; esac
  fi
done
echo " security headers on https://$CANON"
hdr="$(curl -s -m 20 -I "https://$CANON/" 2>/dev/null | tr -d '\r')"
printf '%s' "$hdr" | grep -qi "^content-security-policy:.*frame-ancestors 'none'" && pass "CSP header present (served by our Firebase config)" || fail "no CSP header from $CANON" "the site is not being served by this repo's firebase.json, or has not been deployed"
printf '%s' "$hdr" | grep -qi "^content-security-policy:.*script-src[^;]*'unsafe-inline'" && pass "CSP allows the inline scripts Next.js needs" || warn "CSP does not allow inline scripts" "the app will not hydrate; redeploy the web app from this repo"
printf '%s' "$hdr" | grep -qi "^strict-transport-security:" && pass "HSTS present" || warn "no Strict-Transport-Security header"

echo "== Email records on $CANON (must survive the DNS changes)"
mx="$(doh "$CANON" MX | tr '\n' ' ')"; [ -n "$mx" ] && pass "MX: $mx" || warn "no MX records" "fine if you do not receive mail on this domain; otherwise restore them in hPanel"
spf="$(doh "$CANON" TXT | grep -i 'v=spf1' | head -1)"; [ -n "$spf" ] && pass "SPF: $spf" || warn "no SPF record" "mail from this domain may be marked as spam"
nspf="$(doh "$CANON" TXT | grep -ic 'v=spf1')"; [ "$nspf" -gt 1 ] && fail "more than one SPF record" "merge them into ONE v=spf1 record; two SPF records invalidate both"
echo "        TXT: $(doh "$CANON" TXT | tr '\n' ' ' | cut -c1-200)"

if [ -n "${API_URL:-}" ]; then
  API_URL="${API_URL%/}"; echo "== API at $API_URL"
  [ "$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$API_URL/health/ready")" = "200" ] && pass "/health/ready is 200" || fail "/health/ready is not 200" "check the Cloud Run revision and that MongoDB is reachable"
  acao="$(curl -s -m 20 -I -X OPTIONS -H "Origin: https://$CANON" -H 'Access-Control-Request-Method: POST' "$API_URL/auth/login" | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1)"
  case "$acao" in *"https://$CANON"*) pass "CORS allows https://$CANON" ;; *) fail "CORS does not allow https://$CANON (got: ${acao:-nothing})" "set the LIFEKEEL_URL repo variable to https://$CANON and redeploy the API" ;; esac
fi
echo; echo "Result: $fails failed, $warns warnings"; [ "$fails" -eq 0 ]
