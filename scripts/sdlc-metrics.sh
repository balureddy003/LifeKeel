#!/usr/bin/env bash
# Prints SDLC health numbers from data the repo already has: gh (authenticated) and git.
# Usage: scripts/sdlc-metrics.sh [days]   (default 30). Read-only; costs no Actions minutes.
set -euo pipefail
DAYS="${1:-30}"
command -v gh >/dev/null || { echo "needs the gh CLI" >&2; exit 2; }
command -v jq >/dev/null || { echo "needs jq" >&2; exit 2; }
git fetch -q origin main 2>/dev/null || true
CUTOFF=$(python3 - "$DAYS" <<'PY'
import sys, datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=int(sys.argv[1]))).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)
echo "SDLC metrics, last ${DAYS} days (since ${CUTOFF})"
echo

echo "== Deploys (deploy-api.yml, deploy-web.yml, deploy-local-judge.yml)"
for wf in deploy-api.yml deploy-web.yml deploy-local-judge.yml; do
  gh run list --workflow "$wf" -L 100 --json conclusion,createdAt,updatedAt,headBranch,headSha,status 2>/dev/null \
  | jq -r --arg c "$CUTOFF" --arg wf "$wf" '
      [.[] | select(.createdAt >= $c and .status == "completed")] as $r
      | "\($wf): \($r|length) run(s), \([$r[]|select(.conclusion=="success")]|length) ok, \([$r[]|select(.conclusion=="failure")]|length) failed, \([$r[]|select(.headBranch!="main")]|length) dispatched from a non-main branch"'
done
echo

echo "== Change failure rate (all deploy workflows)"
for wf in deploy-api.yml deploy-web.yml; do
  gh run list --workflow "$wf" -L 100 --json conclusion,createdAt,status 2>/dev/null
done | jq -s -r --arg c "$CUTOFF" '
  [.[][] | select(.createdAt >= $c and .status == "completed")] as $r
  | if ($r|length)==0 then "no completed deploys in the window"
    else "\(([$r[]|select(.conclusion=="failure")]|length)) of \($r|length) deploys failed (\((([$r[]|select(.conclusion=="failure")]|length) * 100 / ($r|length))|floor)%)" end'
echo

echo "== Gate bypasses on main (commits with no PR number in the subject)"
BYPASS=$(git log --first-parent origin/main --since="${DAYS} days ago" --format='%h %s' 2>/dev/null | grep -vE '\(#[0-9]+\)' || true)
if [ -z "$BYPASS" ]; then echo "none"; else echo "$BYPASS" | head -10; fi
echo

echo "== Reverts on main"
git log origin/main --since="${DAYS} days ago" --grep='^Revert' -i --format='%h %s' 2>/dev/null | head -5 | sed 's/^/  /' || true
echo "  count: $(git log origin/main --since="${DAYS} days ago" --grep='^Revert' -i --format='%h' 2>/dev/null | wc -l | tr -d ' ')"
echo

echo "== CI and security minutes by workflow (run wall-clock, summed; jobs bill separately so this is a floor)"
for wf in ci.yml security.yml images.yml claude-review.yml; do
  gh run list --workflow "$wf" -L 100 --json createdAt,updatedAt,status,conclusion,event 2>/dev/null \
  | jq -r --arg c "$CUTOFF" --arg wf "$wf" '
      [.[] | select(.createdAt >= $c and .status=="completed")] as $r
      | ($r | map(((.updatedAt|fromdateiso8601)-(.createdAt|fromdateiso8601))) | add // 0) as $s
      | "\($wf): \($r|length) run(s), \(($s/60)|floor) min, \([$r[]|select(.conclusion=="failure")]|length) failed"'
done
