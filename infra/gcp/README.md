# Lowest-cost GCP footprint, and how it scales with signups

Goal: pay close to nothing until there are users, then grow cost in step with usage. Nothing here has
been deployed from this repo yet; the commands are untested against a real project (the sandbox that
wrote them has no GCP credentials), so do the first run on a project you can safely experiment in.

Prices below are **recalled from memory, not checked** — confirm against the GCP and Atlas price pages
and your first bill. Treat every number as an estimate.

## The shape

| Piece | Setting | Why it is cheap | What it costs you |
|---|---|---|---|
| API (Cloud Run) | `min-instances=0`, CPU only while serving a request, `--cpu-boost` | No idle charge; usually inside the free tier at low volume | A cold start on the first request after idle (a few seconds) |
| Scheduled jobs | **One** Cloud Scheduler job calling `POST /internal/cron/tick` each minute | 3 scheduler jobs per billing account are free; replaces 25 in-process timers that cannot fire on a scaled-to-zero instance | Needs `CRON_MODE=external` and the tick secret (below) |
| Model service (Ollama) | `min_instances=0`, model `qwen2.5:7b`, `max_instances` low | Billed only for busy seconds; ~3.8 emails/min per instance was measured on 3b, and 7b is slower (roughly 1.5-2x, not re-measured) | A 30 s+ cold start (not measured here). Fine for background work; do not use for interactive answers |
| Database | Smallest paid MongoDB Atlas tier (not the free tier) | A few tens of dollars a month; family data should not live on a free tier | Confirm it is a replica set (needed for transactions later) |
| Redis | Pay-per-request serverless Redis, or drop it for a Mongo-backed queue | Near zero at low volume | — |
| Images | Artifact Registry cleanup: keep 2 versions, delete untagged after 3 days | The 4 GB model image would otherwise accumulate | Rollback is limited to the last 2 versions |
| CI/CD | GitHub Actions free allowance; see `docs/ci-cd-cost.md` | Heavy jobs run only when needed | — |
| Domains | `lifekeel.co.uk`, `lifekeel.si` stay at Hostinger; DNS points at Cloud Run / Firebase Hosting | No migration | Two renewals a year |

Rough order of magnitude at launch: tens of dollars a month in total, dominated by the database. A
standing model instance would add roughly $230 a month (recalled price), which is why it defaults to
scale-to-zero. The financial model (`lifekeel-financial-model.xlsx`) lets you change these inputs.

> **Model choice.** The judge defaults to `qwen2.5:7b` because it is the only size that passes the safety
> eval (`node apps/api/dist/eval/local-model-eval.js`). 3b approved a credential-leak case when judging
> alone (re-run 10 Oct 2026, same result as 2 Oct); 1.5b approved unsafe copy. The deterministic guard
> catches those cases first in production, but the eval gate is deliberately model-alone, so do not
> lower the model without re-running it and getting a pass.

## One-time setup

```bash
gcloud auth login
PROJECT_ID=<project> REGION=<region> API_URL=<https://your-api-url> \
  BILLING_ACCOUNT=<id> BUDGET_USD=<monthly alert> infra/gcp/setup-lean.sh
```

It is idempotent. It enables only the APIs used, creates the registry with a cleanup policy, creates the
tick secret in Secret Manager, creates the Cloud Scheduler job, and (optionally) a budget alert. The
budget alert **warns, it does not stop spending**.

Then, in GitHub: set the repository variable `CRON_MODE=external`, and run **Deploy API**. Until you set
`CRON_MODE`, the API keeps running jobs in-process exactly as before, and the scheduler's calls get a
harmless `409`.

> Order matters: the deploy references the secret `lifekeel-cron-tick-secret`. If it does not exist the
> deploy fails. Run `setup-lean.sh` first.

## Scaling as signups grow

Everything scales by changing a setting, not code:

| Signal | Do this |
|---|---|
| API requests queueing or 429s | Raise the `API_MAX_INSTANCES` repo variable (default 4) and redeploy. This is also your cost ceiling. |
| Email/OCR backlog growing (`queue_wait` high) | Raise `max_instances` on the model service (each instance serves one call at a time). Cost rises only with busy time in scale-to-zero mode. |
| Cold starts hurt a feature | Set model `min_instances=1` (about $230/month, price recalled) or keep that feature off interactive paths. |
| Database CPU / connections high | Move up one Atlas tier. Review the nightly sweeps first (they scan; see PRD-139). |
| Hundreds of paying families | Decide on always-on vs scale-to-zero from measured busy hours, using the financial model. |

## Verify (after the first deploy)

1. `gcloud scheduler jobs run lifekeel-cron-tick --location <region>` returns success.
2. API logs show `Cron tick` with `due` / `ok` counts.
3. `/metrics` shows `lifekeel_cron_last_tick_timestamp_seconds` advancing every minute. **Alert on it
   stalling** (no advance for 5 minutes) — that is the signal that scheduled jobs have stopped.
4. `gcloud run services describe` shows `minScale` 0.

## Rollback

- Scheduled jobs: unset the `CRON_MODE` repo variable and redeploy (jobs return to in-process), and
  `gcloud scheduler jobs pause lifekeel-cron-tick --location <region>`.
- Bad revision: `gcloud run services update-traffic <service> --to-revisions <previous>=100 --region <region>`.

## Known limits

- The tick secret is stored in the Scheduler job's header (visible to anyone who can view scheduler
  jobs in the project). Moving to Google-signed OIDC tokens verified in the API is a follow-up.
- Catch-up after an outage is capped at 15 minutes; a job missed for longer waits for its next run.
- The scale-to-zero cold start of the model service has not been measured.
