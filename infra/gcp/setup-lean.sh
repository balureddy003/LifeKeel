#!/usr/bin/env bash
# One-time (idempotent) GCP setup for the lowest-cost footprint. Safe to re-run.
#
#   PROJECT_ID=my-proj REGION=europe-west2 API_URL=https://lifekeel-api-xxxx.a.run.app \
#     [BILLING_ACCOUNT=ABCDEF-123456-789012 BUDGET_USD=100] infra/gcp/setup-lean.sh
#
# Needs an authenticated gcloud (gcloud auth login) with permission to enable APIs and manage Artifact
# Registry, Secret Manager and Cloud Scheduler. It changes nothing about the running services; it only
# prepares what the deploy workflows and the external cron mode need. See infra/gcp/README.md.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
: "${REGION:?set REGION}"
: "${API_URL:?set API_URL to the deployed API base URL (no trailing slash)}"
API_URL="${API_URL%/}"
REPO="${AR_REPO:-lifekeel-docker}"
SECRET="${CRON_SECRET_NAME:-lifekeel-cron-tick-secret}"
JOB="${SCHEDULER_JOB:-lifekeel-cron-tick}"
HERE="$(cd "$(dirname "$0")" && pwd)"
g() { gcloud --project "$PROJECT_ID" "$@"; }

echo "== Enable only the APIs this footprint needs"
g services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com

echo "== Artifact Registry repo with a cleanup policy (old images are the main storage cost)"
if ! g artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1; then
  g artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --description "LifeKeel images"
fi
g artifacts repositories set-cleanup-policies "$REPO" --location "$REGION" --policy "$HERE/artifact-registry-cleanup.json" --no-dry-run

echo "== Cron tick secret (the deploy references it, so it must exist first)"
if ! g secrets describe "$SECRET" >/dev/null 2>&1; then
  g secrets create "$SECRET" --replication-policy automatic
  head -c 32 /dev/urandom | base64 | tr -d '\n=+/' | g secrets versions add "$SECRET" --data-file=-
  echo "created secret $SECRET"
else
  echo "secret $SECRET already exists (left unchanged)"
fi
PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"
g secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor >/dev/null
echo "granted $RUNTIME_SA access to $SECRET (override with RUNTIME_SA=... if the service uses another account)"

echo "== One Cloud Scheduler job drives every scheduled task (3 jobs per billing account are free)"
SECRET_VALUE="$(g secrets versions access latest --secret "$SECRET")"
ARGS=(--location "$REGION" --schedule "* * * * *" --time-zone "Etc/UTC"
      --uri "${API_URL}/internal/cron/tick" --http-method POST
      --headers "x-cron-secret=${SECRET_VALUE}" --attempt-deadline 900s
      --max-retry-attempts 0)   # no retries: the tick catches up missed minutes itself
if g scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  g scheduler jobs update http "$JOB" "${ARGS[@]}"
else
  g scheduler jobs create http "$JOB" "${ARGS[@]}"
fi
# The job is created enabled, but the API answers 409 until CRON_MODE=external is deployed, so it is
# harmless (and costs nothing) until you flip that setting. Pause it with: gcloud scheduler jobs pause $JOB

if [[ -n "${BILLING_ACCOUNT:-}" && -n "${BUDGET_USD:-}" ]]; then
  echo "== Budget alert (cost guard-rail; it alerts, it does not stop spending)"
  g services enable billingbudgets.googleapis.com
  gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" --display-name "lifekeel-monthly" \
    --budget-amount "${BUDGET_USD}USD" --filter-projects "projects/${PROJECT_ID}" \
    --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 || \
    echo "budget not created (it may already exist)"
else
  echo "== Skipping budget alert (set BILLING_ACCOUNT and BUDGET_USD to create one)"
fi

cat <<NEXT

Done. Next:
  1. In GitHub, set repo variable CRON_MODE=external (Settings > Secrets and variables > Actions > Variables).
  2. Run the "Deploy API" workflow. It reads the secret created above.
  3. Verify: gcloud scheduler jobs run $JOB --location $REGION, then check the API logs for "Cron tick",
     and /metrics for lifekeel_cron_last_tick_timestamp_seconds advancing.
NEXT
