# Intent: durable-required production queue

**Problem** — when Redis is unreachable, the hand-rolled queue silently falls
back to in-memory inline mode with no durable DLQ: buffered/retrying jobs are
lost on crash, and a permanently-failing inline job is just a log line.
Recovery also lacks visibility leases, so a new replica can reclaim a live
worker's long job.
Evidence: `queue/QueueManager.ts:96-148, 179-182, 217-219`.

**Done looks like**
- `QUEUE_MODE=required` (or equivalent env policy) in production: Redis down →
  durable jobs refuse honestly; only explicitly-safe inline ops proceed; read
  paths still degrade.
- Visibility timeout/heartbeat on the processing list — stranded-job recovery
  only reclaims expired leases.
- **Costed decision recorded:** lease-aware Redis vs managed queue/BullMQ. If
  the fix approaches rebuilding BullMQ, adopt it now rather than later
  (critical review D2) — do not gold-plate the hand-rolled queue to defer a
  managed one.
- Outage behavior tested (kill Redis mid-suite).

**Constraints**
- Trust tier touched: none directly; protects Tier-2/3 delivery reliability.
- Regulated-advice check: none.
- Data/privacy limits: queue payloads stay ID/reference-based (payload-by-
  reference contract follows in Stage C).

**Out of scope** — per-tenant fair queues and priority bulkheads (P2);
replacing the queue if the durability fix is cheap.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md

**Recorded decision (2026-10-19)** — lease-aware Redis, not BullMQ, this
round. The two live gaps (volatile inline fallback, blind processing-list
recovery) closed for ~200 lines inside the existing `QueueManager`:
`QUEUE_MODE=required` default outside dev/airgap with an explicit
`allowInline` opt for re-runnable jobs, and visibility leases
(`lease:<queue>:<jobId>`) renewed by workers and checked by a periodic
sweeper. BullMQ adoption would have meant a new dependency plus a
subscribe/publish/DLQ/inspect/requeue surface rewrite — not justified by
the current two-queue footprint (webhook ingest, email scan). Revisit if
queues need fair scheduling, priority bulkheads, or payload-by-reference —
that is the point where the hand-rolled layer becomes a BullMQ rebuild.
