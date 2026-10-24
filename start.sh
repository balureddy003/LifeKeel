#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
export PATH="/opt/podman/bin:$PATH"

fail() { printf '%s\n' "$*" >&2; exit 1; }
for tool in pnpm node lsof curl; do
  command -v "$tool" >/dev/null || fail "Missing prerequisite: $tool (see STARTER.md)."
done
[[ -f .env && -f apps/web/.env ]] || fail 'Create .env and apps/web/.env using STARTER.md first.'

if command -v podman >/dev/null; then
  if ! podman info >/dev/null 2>&1; then
    podman machine start || fail 'Could not start Podman. See STARTER.md.'
  fi
  compose=(podman compose -f compose.local.yml)
elif command -v docker >/dev/null; then
  docker info >/dev/null 2>&1 || fail 'Start Docker first.'
  compose=(docker compose -f compose.local.yml)
else
  fail 'Install Podman or Docker with Compose support first.'
fi

free_port() {
  local port="$1" pid command_line attempt
  local listeners
  listeners=$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  for pid in $listeners; do
    command_line=$(ps -p "$pid" -o comm= 2>/dev/null || true)
    case "$command_line" in
      *[Cc]hrome*|*[Cc]hromium*|*[Ff]irefox*|*[Bb]rave*|*[Ss]afari*|*[Ee]dge*)
        fail "Port $port belongs to a browser; leaving it running. Free that port manually."
        ;;
    esac
    printf 'Stopping PID %s on port %s\n' "$pid" "$port"
    kill -TERM "$pid" 2>/dev/null || true
    for attempt in {1..30}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  [[ -z $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true) ]] || fail "Port $port is still occupied."
}

free_port 3001
free_port 3002

# Compose manages infrastructure listeners; never kill Podman's shared port forwarder.
"${compose[@]}" up -d
[[ -d node_modules ]] || pnpm install --frozen-lockfile
pnpm --filter @lifekeel/api build:workspace-deps

log_dir=$(mktemp -d "${TMPDIR:-/tmp}/lifekeel-start.XXXXXX")
api_pid=''
web_pid=''
stop_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$api_pid" ]] || stop_tree "$api_pid"
  [[ -z "$web_pid" ]] || stop_tree "$web_pid"
  wait 2>/dev/null || true
  printf '\nAPI and web stopped. Containers remain running. Logs: %s\n' "$log_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

PORT=3001 pnpm --filter @lifekeel/api dev:watch >"$log_dir/api.log" 2>&1 &
api_pid=$!
pnpm --filter @lifekeel/web dev >"$log_dir/web.log" 2>&1 &
web_pid=$!

printf 'Starting LifeKeel. Logs: %s\n' "$log_dir"
ready=false
for attempt in {1..120}; do
  kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null || {
    tail -n 40 "$log_dir/api.log" "$log_dir/web.log"
    fail 'A service exited during startup.'
  }
  if curl -fsS --max-time 2 http://localhost:3001/health/ready >/dev/null 2>&1 &&
     curl -fsS --max-time 2 http://localhost:3002/ >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { tail -n 40 "$log_dir/api.log" "$log_dir/web.log"; fail 'Services did not become ready.'; }
printf 'Web: http://localhost:3002\nAPI: http://localhost:3001\nMailpit: http://localhost:8025\nCtrl+C stops API and web.\n'
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 2
done
fail "A service stopped. Check $log_dir."
