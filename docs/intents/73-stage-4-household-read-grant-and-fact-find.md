# Intent 73: Stage 4 — Household read grant API and adviser fact-find export

**Problem** — When a household works with an existing financial adviser, solicitor, or partner tool, they currently have to rebuild their fact-find from scratch or hand over a raw GDPR database dump (`GET /account/export`). There is no narrow, revocable read API over the computed brief, and no clean fact-find export designed for an adviser the family already uses.

**Done looks like**
- **Small read API under a household grant (`GET /v1/household-grant/:token`):** projects only the stored brief result (`runway_months`, `solver_version`, `data_version`), `renewal_dates`, `opened_at`, and `document_locations` (never raw file bytes, never `visibility: 'private'` accounts). Does not recompute on every call.
- **Fact-find export (`POST /family/fact-find/export`):** a deterministic, family-initiated export (JSON and printable summary) containing the household's shared runway brief, earners, commitments, policies on file (provider, type, cover amount, renewal date), and document locations—with no raw files unless the member explicitly exports them—ready to send to an adviser the family already has.
- **Revocation preserves the graph:** disconnecting an external partner/grant (`DELETE /family/grants/:id`) or removing a household member (`DELETE /family/members/:id`) immediately revokes their token/session access and records an audit event, while keeping the household graph intact.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0 / Tier 1** (user-initiated read grant creation/revocation and download-only fact-find export; LifeKeel never introduces or selects an adviser).
- Regulated-advice check: the fact-find export goes only to the family (to share with an adviser they *already* have); LifeKeel never acts as an introducer, lead generator, or arranger (`CLAUDE.md` Rule 2).
- Data/privacy limits: grant tokens are SHA-256 hashed at rest, scoped to explicit fields, rate-limited, audited on every read, and never expose raw document/vault bytes or hidden accounts.

**Out of scope** — Adviser marketplace/matching, lead generation, write APIs for third parties, or serving raw vault files over the grant API.

**Becomes** — [docs/prd/225-stage-4-household-read-api-and-fact-find.md](../prd/225-stage-4-household-read-api-and-fact-find.md)
