#!/usr/bin/env bash
# Creates/updates Cloud Scheduler jobs that fire LifeKeel's registered crons
# via POST /internal/cron/<name> (intent 92). Run after the API image that
# serves the route is deployed — until then every fire 404s.
#
# Usage:
#   scripts/ops/create-cron-scheduler.sh <api-base-url> <secret-name> [prefix]
#
#   api-base-url  e.g. https://api.lifekeel.co.uk or the staging run.app URL
#   secret-name   Secret Manager secret holding CRON_TRIGGER_TOKEN
#                 (lifekeel-cron-trigger-token / staging-cron-trigger-token)
#   prefix        scheduler job name prefix (default: cron; use cron-staging
#                 for the staging environment so names don't collide)
#
# The bearer token is read from Secret Manager at run time and passed as an
# Authorization header — it is visible to anyone who can describe the
# scheduler jobs (project viewers). That is the same trust boundary as the
# Secret Manager secret itself.
set -euo pipefail

PROJECT=${PROJECT:-dyocense-502208}
REGION=${REGION:-us-central1}
BASE_URL=${1:?api base url required}
SECRET=${2:?secret name required}
PREFIX=${3:-cron}

TOKEN=$(gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT")
BASE_URL=${BASE_URL%/}

# name|schedule — must match the names registered in apps/api/src/server.ts.
# document-ocr-retry is deliberately absent: it only registers when
# localModelConfigured, which is not the case in cloud deployments.
JOBS=(
  "connector-sync|*/15 * * * *"
  "connector-health|*/15 * * * *"
  "brief-facts-retention|23 4 * * *"
  "email-scan|*/15 * * * *"
  "document-ocr-dispatch|* * * * *"
  "marketing-publish|* * * * *"
  "marketing-generate|23 8 * * *"
  "search-readback|30 6 * * *"
  "marketing-engagement|17 * * * *"
  "revenue-sync|15 4 * * *"
  "profile-check|10 7 * * *"
  "metrics-rollup|40 * * * *"
  "ai-health-alert|*/10 * * * *"
  "autopilot-sweep|50 * * * *"
  "weekly-digest|30 8 * * 1"
  "lifecycle-sweep|25 * * * *"
  "policy-renewal-reminders|17 * * * *"
  "member-agent-loop|15 7 * * *"
  "continuity-check|45 7 * * *"
  "checklist-reminder|10 8 * * *"
  "family-heartbeat-weekly|0 8 * * 1"
  "family-heartbeat-monthly|0 8 1 * *"
  "daily-digest|0 8 * * *"
  "calibration-drift|0 2 * * *"
  "erasure-replay|30 4 * * *"
  "calibration-fit|0 3 * * *"
  "billing|0 4 * * *"
  "stale-profile-evaluation|30 6 * * *"
  "freshness-check|45 6 * * *"
  "scenario-watchlist|30 5 * * *"
  "retention|0 2 * * *"
  "insight-sla-escalation|*/15 * * * *"
  "feature-hash-eval|0 7 * * 1"
  "token-refresh|*/10 * * * *"
)

for entry in "${JOBS[@]}"; do
  name="${entry%%|*}"
  schedule="${entry##*|}"
  job="${PREFIX}-${name}"
  uri="${BASE_URL}/internal/cron/${name}"
  if gcloud scheduler jobs describe "$job" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$job" \
      --location="$REGION" --project="$PROJECT" \
      --schedule="$schedule" --uri="$uri" --http-method=POST \
      --headers="Authorization=Bearer ${TOKEN}" \
      --attempt-deadline=1800s --max-retry-attempts=0 --quiet
  else
    gcloud scheduler jobs create http "$job" \
      --location="$REGION" --project="$PROJECT" \
      --schedule="$schedule" --uri="$uri" --http-method=POST \
      --headers="Authorization=Bearer ${TOKEN}" \
      --attempt-deadline=1800s --max-retry-attempts=0 --quiet
  fi
  echo "ok $job"
done

echo "Created/updated ${#JOBS[@]} scheduler jobs -> $BASE_URL"
