# Intent 74: Move vault and document bytes out of MongoDB GridFS into object storage

> **Status: PARKED — cost optimisation, not a brief requirement.** The brief hot
> path never reads document bytes, so this is gated on aggregate document volume
> crossing the stated storage-cost threshold (ARCHITECTURE.md §15.8), not on the
> brief platform. It is also the most operationally irreversible change in this
> set — do not run it before Stage 1 ships and proves the numbers.

**Problem** — Hot MongoDB storage (GridFS `documents.files` / `documents.chunks`) is an order of magnitude more expensive per GB than object storage (GCS / Cloudflare R2) and inflates database working set, backups, and restore times. Although `apps/api/src/documents/storage.ts` already implements a dual-read seam (`DOCUMENTS_SCHEMA_VERSION = 2`), default uploads and vault writes still land in GridFS unless `DOCUMENTS_STORAGE=r2` / `VAULT_STORAGE=r2` are enabled, and existing GridFS blobs remain in Mongo. Moreover, the brief hot path never needs raw file bytes at all.

**Done looks like**
- All new document and vault uploads write exclusively to object storage (GCS or S3-compatible R2 via `documents/storage.ts`), storing only metadata, `sha256` hash, `size`, `mime_type`, and the object storage pointer (`storage: { bucket, key }`) in MongoDB.
- Vault uploads remain envelope-encrypted (and optionally client-sealed, PRD-134) before bytes are written to object storage.
- A background/one-shot migration script (`scripts/ops/migrate-gridfs-to-object-store.ts`) streams existing `documents.files` / `documents.chunks` rows to object storage, verifies SHA-256 and byte length, updates `storage.key`, and drops the GridFS chunks once verified.
- `documents/storage.ts` refuses new GridFS writes outside `dev`/test mode (enforced by boot guard and fitness test), and the brief endpoints never touch `readDocumentBytes`.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0** (infrastructure storage migration; no external user-facing side effect).
- Regulated-advice check: N/A (storage layer only).
- Data/privacy limits: object storage buckets are private, regional (UK/EU), have no provider AI/content-inspection features enabled (`CLAUDE.md` Rule 3), preserve per-tenant envelope encryption (`tenant_keys`) so crypto-shredding and erasure (`erasure.ts`) delete both the object and the DEK.

**Out of scope** — Introducing a second metadata database; putting document bytes on the brief calculation path.

**Becomes** — [docs/prd/226-brief-scale-and-cost-architecture.md](../prd/226-brief-scale-and-cost-architecture.md)
