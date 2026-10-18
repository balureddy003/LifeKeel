# LifeKeel Architecture — Expert Optimization Review (World-Class + Cost-Efficient)

**Reviewed:** `ARCHITECTURE.md` snapshot dated 17 October 2026, plus spot
verification against `apps/api`, `packages/*`.
**Method:** constructive multi-domain review. Where the critical review
(`architecture-critical-review-2026-10.md`) looked for what is missing or
wrong, this pass asks: *what would each domain expert change to make this
world-class and cost-efficient?* Findings are recommendations, verified
against code where possible; each names an adoption trigger so cost work
doesn't become premature optimization.

**Lens:** cost efficiency means **cost per correct accepted outcome per
active family** — not minimizing any single line item. Where not to save
is stated explicitly at the end.

---

## What already exists (verified)

Cost-aware foundations are better than most products at this stage:

- Deterministic-first cascade, local encoders, exact tenant cache,
  per-task token ceilings, hosted-vs-self-host crossover rule (§8.12).
- **Document cost-tiering already implemented:** upload/storage is free
  on every plan; only the paid vision-extraction step is entitlement-gated
  (`documents-tiering.test.ts`).
- Scale-to-zero API, static web export, minor-unit money, minor ops
  automation, consent-gated marketing sends with ledger dedup.
- Prompt/completion telemetry off by default; local/on-device inference
  options for sensitive tasks.

The recommendations below extend these instincts into a cost *system*.

---

## FinOps / unit economics (new capability)

### R1. Per-tenant unit economics model — P1

There is no cost-of-goods-sold view. Define:

- **Fixed base:** Mongo, Redis, Cloud Run floor, observability — amortized
  per active tenant.
- **Variable per tenant:** AI tokens (by task), OCR pages, document/vault
  storage GB, email/SMS/WhatsApp messages, connector syncs.
- **Derived:** cost per active family per month; gross margin per plan;
  free-tier cost ceiling.

Document-tiering already gates paid AI extraction — extend the same idea
into a `plan_cost_budget` per tier so a free family's AI/delivery spend is
capped by policy, not luck. Reuses the existing `budget_class` primitive.

### R2. Cost attribution in telemetry — P1

§8.12 already requires per-task cost spans. Close the loop: a monthly
rollup job attributing AI/delivery/storage cost to tenant + task class,
surfaced in the operator console alongside plan revenue. Without
attribution, "cost per accepted result" stays theoretical.

---

## Storage & data engineering (largest verified win)

### R3. Move blob bytes out of Mongo GridFS — P2, large saving at scale

Verified: vault bytes **and** uploaded documents are stored in MongoDB
GridFS (`routes/vault.ts`, `routes/documents.ts`). Hot database storage is
an order of magnitude more expensive per GB than object storage, inflates
backup size/restore time, and competes with index working-set memory.

Target: object storage (GCS) for encrypted blobs; Mongo keeps metadata,
pointer, hash, and encryption envelope. Lifecycle rules move cold blobs to
cheaper tiers. Keep GridFS below a documented byte threshold; migrate when
aggregate blob storage crosses it — do not migrate speculatively.

### R4. Cold data out of hot storage — P2

- **Audit (7-year TTL):** append-only history in hot Mongo is the worst
  cost/performance profile for data that is rarely read. Export to WORM
  object storage — simultaneously cheaper *and* solves the tamper-evidence
  P1 already registered. Query path reads recent Mongo + cold archive.
- **Feed/readiness history, metrics rollups:** archive beyond a retention
  horizon rather than growing hot collections.

### R5. Backup tiering by data class — P2

When the RPO/RTO work lands (existing P0), do not back up uniformly:
authority data (profile, vault pointers, receipts, audit) gets PITR;
**rebuildable derived state** (feed, readiness projections, rollups, LLM
cache) gets none — it is reconstructed. Backup scope is a real cost lever
and speeds restore.

---

## Compute & scheduling

### R6. Change-driven evaluation, not fixed sweeps — P2

Stale-profile and related jobs re-evaluate on cadence. As tenant count
grows, most sweeps evaluate unchanged inputs — wasted Mongo reads and
compute. Move to **event-driven invalidation**: profile/document/connector
writes mark affected detectors dirty; the sweep only visits dirty tenants.
Fixed cadence remains as a correctness fallback. Pairs with the
incremental-dependency-graph pattern already in Layer 6.

### R7. Queue payload-by-reference — P2

Queue jobs serialize `payload` JSON. Rule: payloads carry **IDs and
locators**, never content (no email bodies, document bytes, or prompts).
Keeps Redis small and fast, shrinks DLQ blast radius, and makes payload
schema versioning tractable. Enforce a max-payload-bytes budget in the
publisher contract.

### R8. Batch windows for non-urgent work — P2

Email-scan fan-out, OCR retries, engagement polling, and metric rollups
should run in off-peak batch windows with bounded concurrency rather than
spread across interactive hours. This flattens Mongo/provider load and
keeps interactive p95 cheap — the cheapest SLO protection is scheduling.

### R9. Measure cold start before buying min-instances — P2

Scale-to-zero is the right default. If cold start (embedding init + YAML
load + first connections) breaches the interactive SLO, prefer **deferred
model init** or a min-instance floor of 1 during business hours only —
scheduled concurrency is cheaper than always-on.

---

## Delivery & external spend

### R10. Cost-aware channel routing — P2

The delivery router honors preferences and urgency. Add a cost tier to
channel selection: within user preferences, prefer push → email → SMS →
WhatsApp; reserve paid channels for urgency or explicit choice. Per-message
channel cost belongs in the delivery decision record, and per-tenant
messaging spend rolls into R1's unit economics.

### R11. Unified external-spend guardrail — P2

Marketing already has a 2,000-recipient campaign ceiling and per-task AI
budgets exist as primitives. Unify: a per-tenant/plan **external spend
ledger** covering AI tokens + paid messages + paid OCR, enforced at the
same gateway. One budget mechanism beats three partial ones.

### R12. Egress discipline for vision workloads — P2

Hosted vision OCR sends full document images — the egress-heaviest AI
task. For bulk backlogs, prefer local/regional processing or hosted
**batch** endpoints per the §8.12 infrastructure matrix; reserve
synchronous hosted vision for interactive uploads.

---

## Observability cost — P2

### R13. Volume controls

- **Trace sampling:** head-based sampling for routine success paths,
  always-on for errors, AI calls, actions, and security events. Tail
  sampling when an OTel collector exists.
- **Log policy:** structured INFO in production, DEBUG content stays
  off (already the rule for prompts); alert-driven debug, not ambient.
- **Label cardinality budget:** already a P1 for tenant IDs — extend to a
  written budget per metric family; high-cardinality dimensions live in
  traces/logs only.

---

## Build / CI efficiency — P3

### R14. Developer-cost hygiene

Turbo cache + pnpm store cache in CI, dependency-update batching, and
skipping unchanged-package builds are cheap wins. Mobile stays out of the
root graph (correct). Not architecture-critical; record as convention.

---

## AI cost — already covered; do not duplicate

§8.12 holds the complete token/infra story: deterministic-first, local
encoders, task token ceilings, context allow-lists, prompt caching,
batch APIs, and the measured 1.3× hosted→self-host crossover. This review
adds nothing new there — which is itself the finding: the AI cost model
is the strongest-designed (if not yet fully wired) part of the system.

---

## Where NOT to save money

Cost-efficiency that removes these is a regression, not an optimization:

- **Symmetric input/output guards** on every model path — saving tokens by
  skipping guards trades money for the regulatory boundary.
- **Evaluation/adversarial CI** — evals are the cost of trusting cheaper
  models; cutting them raises the price of being wrong.
- **Audit and receipts** — non-negotiable evidence, including the WORM
  export that R4 makes cheaper anyway.
- **Authority-data backups** — R5 saves on *derived* data only.
- **Secondary transactional email** — the one place this review recommends
  *spending more* (proactive alerts are the product).
- **Signed-link approval strengthening** — do not defer on cost grounds.

## Recommended gap-register additions

| Priority | Item |
|---|---|
| P1 | Per-tenant unit economics / COGS model with plan cost ceilings |
| P1 | Cost attribution rollup (tenant × task × provider) in operator console |
| P2 | Blob bytes in Mongo GridFS → object storage with pointer metadata |
| P2 | Cold data (7-yr audit, history, rollups) out of hot Mongo to WORM archive |
| P2 | Backup tiering: no backup for rebuildable derived state |
| P2 | Change-driven detector evaluation vs fixed sweeps |
| P2 | Queue payload-by-reference discipline |
| P2 | Off-peak batch windows for non-urgent jobs |
| P2 | Cost-aware delivery channel routing |
| P2 | Unified per-tenant external-spend ledger |
| P2 | Observability volume controls (sampling, log policy, label budget) |
