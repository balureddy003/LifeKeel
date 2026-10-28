# Intent 77: Queue payload-by-reference contract and cold-start / brief p95 gate

> **Status: PARKED — scale concern, not Stage 1.** The payload cap and cold-start
> histogram are cheap hygiene, but nothing in the Stage 1 cut produces queue
> payloads or traffic that justifies them ahead of the brief itself. Proceed
> when brief volume or a concrete payload violation justifies it.

**Problem** — `QueueManager.publish(queue, payload)` in `apps/api/src/queue/QueueManager.ts` currently accepts arbitrary `unknown` payloads without a size ceiling or a content ban, risking Redis memory bloat and oversized dead-letter queues (`${queue}:dead`) if a caller passes document bytes or large text blobs. Additionally, Cloud Run scale-to-zero cold start and brief hot-path p95 need an explicit measurement gate so `min-instances` stays at `0` until real traffic proves otherwise.

**Done looks like**
- **IDs, not content in Redis queues:** `QueueManager.publish` enforces a hard maximum serialized payload size (`MAX_QUEUE_PAYLOAD_BYTES = 4096`, 4 KB) and rejects payloads containing raw buffers/base64 blobs (`Buffer`, `content_bytes`, `raw_text`, `file_bytes`) with a typed `QueuePayloadTooLargeError`.
- **Fitness test:** a unit/architecture test verifies that every `queueManager.publish` call site passes only tenant/resource IDs and small control metadata, never document or email bodies.
- **Scale-to-zero + cold-start / brief p95 measurement:** keep Cloud Run `min-instances: 0`; defer heavy optional initialization (such as local encoder warm-up) off the critical boot/brief path; record cold-start duration and brief hot-path p95 latency in `/metrics` and `/operator/operations` with a documented decision gate to set `min-instances: 1` only if brief p95 breaches target under real traffic.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0** (queue publisher contract and latency telemetry).
- Regulated-advice check: N/A.
- Data/privacy limits: keeping content out of Redis queues and DLQs reduces sensitive data exposure in cache/queue memory.

**Out of scope** — Replacing Redis with a separate message bus (Kafka/PubSub/RabbitMQ) or splitting microservices.

**Becomes** — [docs/prd/226-brief-scale-and-cost-architecture.md](../prd/226-brief-scale-and-cost-architecture.md)
