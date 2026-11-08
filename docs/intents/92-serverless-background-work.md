# Intent: serverless background work — Cloud Scheduler crons, queue consumers revisited

**Problem** — `lifekeel-jobs` (prod) and `lifekeel-jobs-staging` each run
`minScale=1` with `cpu-throttling: false` on Cloud Run, billing a full vCPU
24/7 (~$65/service/month, ~$130 total — ~85% of the project's GCP spend).
The jobs role exists for two reasons: ~30 `cron.schedule`/`setInterval`
timers (token refresh, connector poll, billing, calibration, freshness,
digests, marketing/OCR sweeps, erasure replay) and three Redis queue
consumers (webhook ingest, email-scan fan-out, campaign send). Only the
consumers genuinely need a persistent process; the crons are just scheduled
function calls that Cloud Scheduler can make for ~$0.10/job/month.

**Done looks like**
- Every `cron.schedule`/interval job in `apps/api/src/server.ts` is reachable
  as an authenticated `POST /internal/cron/<name>` (or equivalent) on the API
  service, idempotent and safe under the existing cron-lock semantics.
- Cloud Scheduler jobs in `us-central1` fire each cron at its current
  cadence, with OIDC/IAM or shared-secret auth — no new public surface.
- `SERVICE_ROLE=jobs` no longer schedules timers; it only runs queue
  consumers (or is removed entirely if consumers move — see below).
- `lifekeel-jobs-staging` stays at `min-instances=0` when idle; staging
  cost drops to ~$0–5/month.
- Prod decision recorded: either jobs stays at min 1 for consumers only
  (~$65/mo, documented as the floor) or consumers fold into the API role /
  migrate to Cloud Tasks in a follow-up.

**Constraints**
- Trust tier touched: background jobs deliver insights and execute approved
  actions (campaign sends, delivery router) — Tier 1/2 behaviour must not
  change; the refactor moves *when* code runs, not *what* it is allowed to do.
- Approval gate: unchanged — `ActionExecutor`/`approvedBy` paths and the
  trust-tier-gate test must keep passing.
- Regulated-advice check: no new copy; n/a.
- Data/privacy: cron endpoints process family data — they must be
  internal-only (ingress or IAM), authenticated, and must not accept tenant
  scope from the caller beyond what the job itself iterates.
- Multi-replica safety: cron-lock (`apps/api/src/jobs/cron-lock.ts`) must
  still prevent double-firing when the API scales past 1 instance —
  Scheduler + API autoscaling makes this *more* important, not less.
- Jobs that must run to completion beyond an HTTP request deadline need a
  documented answer (Cloud Run Job, or accepted split).

**Out of scope**
- Migrating the Redis/BullMQ queues to Cloud Tasks (separate, larger intent).
- Changing cron cadences, job logic, or delivery behaviour.
- Any change to production until staging has run a full day on Scheduler.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md
