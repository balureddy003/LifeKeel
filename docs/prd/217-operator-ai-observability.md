# PRD-217: Operator AI observability and control surface

## Problem

The operator console covers queues, connectors, reminders, autopilot, dual
approvals, cost snapshots, and retention — but has **zero visibility into the
AI gateway layer** that PRDs 211–215 depend on. Ask Keel was silently
returning canned fallbacks on every call, and nothing in `/operator`
surfaced it: the failure was only found by probing production manually.
The telemetry partially exists (`lifekeel_local_model_*`,
`lifekeel_output_guard_blocks_total`, `lifekeel_llm_cost_microdollars_total`,
breaker-state gauges, per-task usage callbacks into CostLedger,
`judge_shadow_results`) but is Prometheus-side or collection-side with no
operator-facing aggregation. The PRD-211 blocker — hosted processors all
`unreviewed` — is also invisible anywhere in the product.

## Who it's for

The operator (finds degraded AI paths before users do); engineering (sees
the same numbers the gateway enforces); the founder (cost per answered
question is a business metric, not a log line).

## What "done" looks like

1. **`/operator/ai` page + `GET /operator/ai-health`** (new `operations.read`
   data, no new permission tier): per-task cards showing, over 24h/7d —
   call volume, p50/p95 latency, outcome mix (ok / deadline / breaker /
   guard-reject / budget-denied / fallback-served), which processor actually
   served (ollama vs hosted vs on-device-escalation), queue wait for local
   calls, breaker state per task.
2. **Processor registry panel**: every `ai-processors.yaml` entry with its
   status (approved / unreviewed / review-date-lapsed) and which tasks may
   use it — the PRD-211 checklist made visible. Read-only; approving a
   processor stays a code/terms change, not a console toggle.
3. **Cost section**: usage-ledger join — cost per task per day, cost per
   active family (extends the existing econ block on `/operator/operations`),
   local-model busy-hour estimate from `recordLocalModelCall`.
4. **Escalation/cascade visibility** (PRD-215 metric, made operator-first):
   which tier served each task (rules / encoder / decision / generator),
   generation-escape rate for `assistant.answer.v1` once PRD-212 lands,
   guard-block reasons ranked.
5. **Controls — narrow and audited**: a per-task "disable → honest fallback"
   switch (runtime flag read by the gateway, stored in platform-config),
   behind `ReasonAction` with operator audit entry; anything affecting a
   `lifekeel_infra_required` task additionally requires dual-approval
   (existing four-eyes machinery). No model switching, no env edits, no
   processor approval via console.
6. **Digest integration**: an AI section in the existing operator weekly
   digest — calls by task, fallback/failure share, top guard-block reason,
   spend delta week-over-week.
7. **Alerting**: `lifekeel_assistant_live_share` (or equivalent task-level
   fallback-rate metric) wired to the ops-alerts path, so a repeat of "every
   question fell back" pages someone instead of waiting for a manual probe.

## Constraints

- **Trust tier:** 0 for reads; Tier 2 surface discipline for the disable
  switch — operator-initiated, audited, dual-approved where it touches a
  quarantine task, and the fallback it triggers is the honest one, never a
  silent swap to a hosted processor.
- **Regulated-advice check:** none — operational surface only.
- **Data/privacy:** metadata-first only. No prompt or completion content in
  the operator view — task ids, outcomes, latencies, token counts, tenant
  counts. This is a hard rule, same as the gateway's own telemetry policy:
  the operator console never becomes a family-content reader. (Support
  tooling that legitimately needs content is a separate surface with its own
  authorization.)

## Builds on

`/operator/operations` (the card/ReasonAction/runbook patterns to reuse),
`routes/metrics.ts` (existing counters to aggregate, not duplicate),
`platform-config.ts`, `dual-control.ts`, `weekly-digest.ts`,
`judge_shadow_results`; ARCHITECTURE.md §8.12 (required telemetry) and
§8.4b (the split this page reports on).

## Success metrics

A repeat of the October incident is detectable on `/operator/ai` within
minutes (fallback share spike + deadline-error mix), not days; every
registered task has a live health card; processor review state is visible
without opening the repo; the weekly digest reports AI health in one
paragraph the way it already does marketing.

## Out of scope

Grafana/external dashboards (Prometheus already covers those; this is the
in-product view), prompt/content inspection, per-tenant AI billing pages,
autopilot rules for AI tasks, and any change to what the gateway enforces —
this PRD surfaces and flags, it does not widen authority.

## Open questions

Does `GET /operator/ai-health` aggregate from the `usage`/`spend` collections
or scrape the Prometheus registry? Prefer collections for trendable data and
the registry only for instantaneous state (breaker, queue wait) — decide in
implementation.
