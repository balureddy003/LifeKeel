#!/usr/bin/env bash
# IMS evidence pack (ISO_AUDITABLE.md §21, G-SEC-01). Read-only: it exports the GitHub
# settings and change records an auditor samples, with a sha256 manifest so the pack can
# be shown to be unaltered after collection.
#
#   scripts/ims/evidence-pack.sh [out_dir] [pr_sample_size]
#
# Needs `gh` authenticated with read access to the repo (admin read for branch
# protection and collaborators — those files record the HTTP error instead if denied).
# The output names collaborators: keep it with audit records, outside the repository.
set -euo pipefail

OUT=${1:-"${TMPDIR:-/tmp}/lifekeel-evidence-$(date -u +%Y%m%dT%H%M%SZ)"}
N=${2:-10}
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
BRANCH=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
mkdir -p "$OUT"

# Write the API response, or the error, so a missing permission is itself recorded.
api() {
  local file=$1
  shift
  if ! gh api "$@" >"$OUT/$file" 2>"$OUT/$file.err"; then
    echo "  ! $file: $(head -c 200 "$OUT/$file.err")"
  else
    rm -f "$OUT/$file.err"
  fi
}

echo "Collecting evidence for $REPO ($BRANCH) into $OUT"
api repo.json "repos/$REPO" --jq '{full_name, visibility, default_branch, allow_auto_merge, delete_branch_on_merge, allow_force_pushes: .allow_force_pushes, security_and_analysis}'
api branch-protection.json "repos/$REPO/branches/$BRANCH/protection"
api rulesets.json "repos/$REPO/rulesets"
api environments.json "repos/$REPO/environments" --jq '[.environments[] | {name, protection_rules, deployment_branch_policy}]'
api collaborators.json "repos/$REPO/collaborators" --paginate --jq '[.[] | {login, role_name}]'
api deployments.json "repos/$REPO/deployments?per_page=30" --jq '[.[] | {id, environment, ref, sha, creator: .creator.login, created_at}]'
api dependabot-alerts.json "repos/$REPO/dependabot/alerts?state=open&per_page=100" --jq '[.[] | {number, severity: .security_advisory.severity, package: .dependency.package.name, created_at}]'

gh pr list --repo "$REPO" --state merged --limit "$N" \
  --json number,title,mergedAt,mergedBy,author,reviewDecision,reviews,statusCheckRollup,baseRefName \
  >"$OUT/merged-prs.json"

gh run list --repo "$REPO" --workflow deploy-api.yml --limit 20 \
  --json databaseId,event,status,conclusion,headSha,createdAt,displayTitle \
  >"$OUT/deploy-api-runs.json" 2>/dev/null || echo "  ! deploy-api-runs.json: not available"

# Signed-commit status on the default branch (G = good signature). GitHub merge commits
# are signed by GitHub's key, which the local keyring may not hold: that shows as E.
git fetch -q origin "$BRANCH"
git log "origin/$BRANCH" -100 --format='%H %G? %an %s' >"$OUT/signed-commits.txt"
awk '{c[$2]++} END {for (k in c) printf "%s %d\n", k, c[k]}' "$OUT/signed-commits.txt" \
  | sort >"$OUT/signed-commits-summary.txt"

{
  echo "repo: $REPO"
  echo "branch: $BRANCH"
  echo "head: $(git rev-parse "origin/$BRANCH")"
  echo "collected_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "collected_by: $(gh api user --jq .login)"
  echo "files:"
  (cd "$OUT" && for f in *; do [ "$f" = MANIFEST.txt ] || shasum -a 256 "$f"; done)
} >"$OUT/MANIFEST.txt"

echo "Done. Review $OUT/MANIFEST.txt and any *.err files."
