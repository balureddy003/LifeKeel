#!/usr/bin/env bash
# One-command local setup for macOS or Linux. Idempotent: safe to re-run, never overwrites your .env files.
#
#   scripts/dev-setup.sh            # check tools, install dependencies, create .env files, start databases
#   scripts/dev-setup.sh --verify   # ...then build and boot the real API on a fresh database, sign a user up
#
# Written for bash 3.2 (the one macOS ships). It only reads/starts things and prints exactly what to do when
# something is missing; it does not install system software for you (Homebrew, Docker, Node).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MIN="${SETUP_NODE_MIN:-22.12.0}"   # keep in step with package.json "engines" (override only for testing)
PNPM_VERSION="8.15.5"                   # keep in step with package.json "packageManager"
VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   ok    %s\n' "$1"; }
warn() { printf '   WARN  %s\n' "$1"; }
die()  { printf '   FAIL  %s\n' "$1" >&2; [ -n "${2:-}" ] && printf '         %s\n' "$2" >&2; exit 1; }

# true if $1 >= $2, comparing dotted versions numerically (no sort -V: not on every macOS)
version_ge() {
  local a="$1" b="$2" i x y
  for i in 1 2 3; do
    x="$(echo "$a" | cut -d. -f$i)"; y="$(echo "$b" | cut -d. -f$i)"
    x="${x:-0}"; y="${y:-0}"
    [ "$x" -gt "$y" ] && return 0
    [ "$x" -lt "$y" ] && return 1
  done
  return 0
}

# host and port of a mongodb:// or redis:// URL (ignores credentials and path)
url_host() { echo "$1" | sed -E 's#^[a-zA-Z0-9+.-]+://([^@/]*@)?##; s#[/?].*$##; s#:.*$##'; }
url_port() { local p; p="$(echo "$1" | sed -E 's#^[a-zA-Z0-9+.-]+://([^@/]*@)?##; s#[/?].*$##' | sed -nE 's#^[^:]*:([0-9]+).*#\1#p')"; echo "${p:-$2}"; }
# TCP connect with a 3 second limit, in pure bash (macOS has no `timeout`; a blackholed host would otherwise hang).
port_open() {
  ( exec 3<>"/dev/tcp/$1/$2" ) >/dev/null 2>&1 &
  local pid=$! n=0
  while kill -0 "$pid" 2>/dev/null; do
    n=$((n + 1))
    if [ "$n" -ge 15 ]; then kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 1; fi
    sleep 0.2
  done
  wait "$pid"
}

step "Platform"
OS="$(uname -s)"; ARCH="$(uname -m)"
ok "$OS $ARCH (bash ${BASH_VERSION%%(*})"

step "Node >= $NODE_MIN"
command -v node >/dev/null 2>&1 || die "Node is not installed" "macOS: 'brew install node@22'  or use nvm (https://github.com/nvm-sh/nvm), then re-run"
NODE_V="$(node -p 'process.versions.node')"
version_ge "$NODE_V" "$NODE_MIN" || die "Node $NODE_V is too old (need >= $NODE_MIN)" "macOS: 'brew install node@22' and put it first on PATH, or 'nvm install 22'"
ok "node $NODE_V"

step "pnpm $PNPM_VERSION"
if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version 2>/dev/null)" != "$PNPM_VERSION" ]; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null 2>&1 || die "corepack could not activate pnpm $PNPM_VERSION" "try: npm install -g pnpm@$PNPM_VERSION"
  else
    die "pnpm $PNPM_VERSION is not available and corepack is missing" "run: npm install -g pnpm@$PNPM_VERSION"
  fi
fi
ok "pnpm $(pnpm --version)"

step "Dependencies"
pnpm install --frozen-lockfile >/dev/null 2>&1 || { pnpm install --frozen-lockfile 2>&1 | tail -15; die "pnpm install failed" "on macOS, native modules may need Xcode command-line tools: xcode-select --install"; }
ok "pnpm install"

step "Config files (never overwritten)"
[ -f .env ] && ok ".env exists, left as is" || { cp .env.example .env; ok "created .env from .env.example"; }
[ -f apps/web/.env ] && ok "apps/web/.env exists, left as is" || { cp apps/web/.env.example apps/web/.env; ok "created apps/web/.env"; }

# Read just the two connection strings from .env (do not source the whole file).
env_val() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
MONGODB_URL="${MONGODB_URL:-$(env_val MONGODB_URL)}"; MONGODB_URL="${MONGODB_URL:-mongodb://localhost:27017}"
REDIS_URL_VAL="${REDIS_URL:-$(env_val REDIS_URL)}"
MONGO_H="$(url_host "$MONGODB_URL")"; MONGO_P="$(url_port "$MONGODB_URL" 27017)"

step "MongoDB at $MONGO_H:$MONGO_P (required)"
case "$MONGO_H" in localhost|127.0.0.1|::1) LOCAL=1 ;; *) LOCAL=0 ;; esac
if [ "${MONGODB_URL#mongodb+srv://}" != "$MONGODB_URL" ]; then
  # Atlas-style SRV URL: the name has no database port to probe; the API reports connectivity when it starts.
  ok "hosted database (mongodb+srv): connectivity is checked when the API starts (/health/ready)"
elif port_open "$MONGO_H" "$MONGO_P"; then
  ok "already running"
elif [ "$LOCAL" = 0 ]; then
  # A remote database may be behind a VPN or an IP allow-list; do not block setup on it.
  warn "cannot reach $MONGO_H:$MONGO_P from here (VPN or IP allow-list?). Setup continues; /health/ready will say if the API cannot connect."
else
  STARTED=0
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "   starting MongoDB and Redis with Docker..."
    docker compose -f apps/api/docker-compose.yml up -d mongodb redis >/dev/null 2>&1 && STARTED=1 || warn "docker compose failed"
  elif command -v brew >/dev/null 2>&1 && BREW_MONGO="$(brew list --formula 2>/dev/null | grep '^mongodb-community' | head -1)" && [ -n "$BREW_MONGO" ]; then
    # The formula is versioned (e.g. mongodb-community@7.0), so match the prefix instead of a fixed name.
    echo "   starting $BREW_MONGO (and Redis, if installed) with Homebrew services..."
    brew services start "$BREW_MONGO" >/dev/null 2>&1 && STARTED=1 || true
    if brew list --formula 2>/dev/null | grep -q '^redis$'; then brew services start redis >/dev/null 2>&1 || true; fi
  fi
  if [ "$STARTED" = 1 ]; then
    for _ in $(seq 1 30); do port_open "$MONGO_H" "$MONGO_P" && break; sleep 1; done
  fi
  port_open "$MONGO_H" "$MONGO_P" || die "MongoDB is not reachable at $MONGO_H:$MONGO_P" \
    "start it: 'docker compose -f apps/api/docker-compose.yml up -d mongodb redis' (Docker Desktop must be running), or on macOS 'brew tap mongodb/brew && brew install mongodb-community@7.0 && brew services start mongodb-community@7.0'. If your database is elsewhere, set MONGODB_URL in .env."
  ok "MongoDB is up"
fi

step "Redis (optional locally)"
if [ -n "$REDIS_URL_VAL" ]; then
  RH="$(url_host "$REDIS_URL_VAL")"; RP="$(url_port "$REDIS_URL_VAL" 6379)"
  port_open "$RH" "$RP" && ok "Redis is up at $RH:$RP" || warn "REDIS_URL is set but nothing answers at $RH:$RP (the API still runs; some features need it)"
else
  ok "REDIS_URL not set: fine for local development"
fi

if [ "$VERIFY" = 1 ]; then
  step "Verify: build, then boot the real API on a fresh database and sign a user up"
  pnpm build >/dev/null 2>&1 || { pnpm build 2>&1 | tail -20; die "pnpm build failed"; }
  ok "pnpm build"
  export MONGODB_URL
  [ -n "$REDIS_URL_VAL" ] && export REDIS_URL="$REDIS_URL_VAL" || export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
  scripts/boot-smoke.sh || die "boot smoke test failed" "the log above shows the server's last lines"
fi

cat <<NEXT

Ready. Start the apps (two terminals):
  pnpm --filter @lifekeel/api dev      # http://localhost:3001   (check: curl localhost:3001/health/ready)
  pnpm --filter @lifekeel/web dev      # http://localhost:3002   (create your first user at /signup)
More: README.md, docs/local-testing.md
NEXT
