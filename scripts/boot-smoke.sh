#!/usr/bin/env bash
# Boots the BUILT API the way a deploy would and checks it becomes ready.
#
# Why: unit tests never start the server, so a bad deploy-time environment only shows up
# in production. In particular deploy-api.yml passes optional settings as KEY=${{ vars.KEY }},
# which is KEY= (empty) when the repo variable does not exist; a strict enum once rejected ''
# and the API refused to start. This script sets EVERY variable the workflow passes that way
# to empty, deriving the names from the workflow so a newly added variable is covered
# automatically.
#
# Needs: a built API (pnpm build), MongoDB and Redis.  Usage:
#   MONGODB_URL=mongodb://127.0.0.1:27017 REDIS_URL=redis://127.0.0.1:6379 scripts/boot-smoke.sh
# Set SMOKE_IMAGE=<image> to boot that Docker image instead of node (host networking, so the
# MongoDB/Redis URLs must be reachable from the host, e.g. 127.0.0.1). Needs no local build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/deploy-api.yml"
PORT="${SMOKE_PORT:-3991}"
TIMEOUT_S="${SMOKE_TIMEOUT_S:-90}"
LOG="$(mktemp -t boot-smoke.XXXXXX.log)"

: "${MONGODB_URL:?set MONGODB_URL}"
: "${REDIS_URL:?set REDIS_URL}"
if [ -z "${SMOKE_IMAGE:-}" ]; then
  [ -f "$ROOT/apps/api/dist/server.js" ] || { echo "apps/api/dist/server.js missing: run pnpm build first" >&2; exit 2; }
fi

# Names the deploy workflow passes as KEY=${{ ... }} (everything under env_vars: up to secrets:).
mapfile -t DEPLOY_VARS < <(awk '/env_vars: \|/{f=1;next} /secrets: \|/{f=0} f && /=\$\{\{/{sub(/^[ \t]+/,""); sub(/=.*/,""); print}' "$WORKFLOW")
[ "${#DEPLOY_VARS[@]}" -gt 0 ] || { echo "found no \${{ }} variables in $WORKFLOW: parser out of date?" >&2; exit 2; }

env_args=(NODE_ENV=production KAIROS_DEPLOYMENT_MODE=cloud LOG_LEVEL=info PORT="$PORT"
  MONGODB_URL="$MONGODB_URL" MONGODB_DB="${MONGODB_DB:-agentoak_smoke}" REDIS_URL="$REDIS_URL"
  JWT_SECRET="smoke-jwt-secret-smoke-jwt-secret-0123456789"
  SETTINGS_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
for v in "${DEPLOY_VARS[@]}"; do env_args+=("$v="); done   # empty, like an unset repo variable
echo "Booting with ${#DEPLOY_VARS[@]} deploy-style EMPTY variables: ${DEPLOY_VARS[*]}"

if [ -n "${SMOKE_IMAGE:-}" ]; then
  ENV_FILE="$(mktemp -t boot-smoke-env.XXXXXX)"
  printf '%s\n' "${env_args[@]}" >"$ENV_FILE"
  CONTAINER="boot-smoke-$$"
  docker run --rm --name "$CONTAINER" --network host --env-file "$ENV_FILE" "$SMOKE_IMAGE" >"$LOG" 2>&1 &
  SERVER_PID=$!
  cleanup() { docker stop "$CONTAINER" >/dev/null 2>&1 || true; wait "$SERVER_PID" 2>/dev/null || true; rm -f "$ENV_FILE"; }
else
  env "${env_args[@]}" node "$ROOT/apps/api/dist/server.js" >"$LOG" 2>&1 &
  SERVER_PID=$!
  cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
fi
trap cleanup EXIT

fail() { echo "BOOT SMOKE FAILED: $1" >&2; echo "---- server log (last 40 lines) ----" >&2; tail -n 40 "$LOG" >&2; exit 1; }

for _ in $(seq 1 "$TIMEOUT_S"); do
  kill -0 "$SERVER_PID" 2>/dev/null || fail "server exited during startup"
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health/ready" || true)"
  [ "$code" = "200" ] && break
  sleep 1
done
[ "${code:-}" = "200" ] || fail "/health/ready did not return 200 within ${TIMEOUT_S}s (last status: ${code:-none})"
grep -q 'FATAL' "$LOG" && fail "log contains FATAL"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health/live")" = "200" ] || fail "/health/live is not 200"
echo "OK: API booted with empty deploy variables and /health/ready is 200"
