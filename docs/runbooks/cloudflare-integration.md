# Runbook: Cloudflare integration rollout (Turnstile, email OTP, R2)

Design: [CLOUDFLARE_INTEGRATION.md](../../CLOUDFLARE_INTEGRATION.md). This runbook is the
part only a person can do: accounts, secrets, buckets, deploys, drills, sign-offs. Each phase
is turned on by configuration; the code for all phases ships together.

**Never roll the API back to a release older than the one that introduced
`apps/api/src/documents/storage.ts` once any document lives in R2** (§7.9). Builds from that
release on refuse to boot against a database whose `platform_markers.documents_schema_floor`
is newer than they understand; older builds have no such check and would 404 R2 documents.

## 0. Before the next API deploy (required: boot guards)

The API now refuses to start outside dev when a guard fails. Create these Secret Manager
secrets first (deploy-api.yml mounts them; a missing secret fails the deploy step before any
traffic moves):

| Secret | Value |
|---|---|
| `lifekeel-metrics-scrape-token` | 32+ random chars. Put the same value in the Prometheus scrape config as `Authorization: Bearer …` |
| `lifekeel-turnstile-secret-key` | **Only when `TURNSTILE_MODE` is `monitor` or `enforce`** (not bound by `deploy-api.yml` while it is `off`). Turnstile widget secret (Cloudflare dashboard → Turnstile → add site; hostnames = the Firebase app hosts) |
| `lifekeel-otp-pepper` | 48+ random chars (`openssl rand -base64 48`) |
| `lifekeel-sendgrid-api-key` | **Only when `AUTH_OTP_MODE` is not `off`** (not bound while it is `off`; other emails no-op without it). SendGrid key for the authenticated sending domain (SPF/DKIM/DMARC for `accounts@lifekeel.co.uk`) |

Then set GitHub **Variables** for the first deploy (safe start). A deployment that does not use Turnstile or
email OTP sets `TURNSTILE_MODE=off` and `AUTH_OTP_MODE=off`; it then needs neither the Turnstile nor the SendGrid
secret, and the boot guard logs the downgrade:

| Variable | First deploy | Later |
|---|---|---|
| `TURNSTILE_MODE` | `monitor` | `enforce` after a week of clean metrics (Phase 1) |
| `AUTH_OTP_MODE` | `off` | `signup` (Phase 2), then `signup_login` (Phase 3) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web) | the widget site key | — |
| `DOCUMENTS_STORAGE` | unset (`gridfs`) | `r2` in Phase 4b |

Leaving `TURNSTILE_MODE`/`AUTH_OTP_MODE` unset means the code defaults: `enforce` and
`signup_login`. Downgrades are logged at boot (`Boot guard exception in effect`).

Verify after deploy: `curl -s -o /dev/null -w '%{http_code}' $API/metrics` → `401`; with the
bearer token → `200`. `/auth/demo-token` → `403`.

## Phase 1: Turnstile

1. Web deploy with `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (the CSP in `firebase.json` already allows
   `challenges.cloudflare.com`).
2. API with `TURNSTILE_MODE=monitor`. Watch `lifekeel_turnstile_verify_total{action,result}`
   for a week; failures with `result="failed"` from real users mean a hostname or action
   mismatch, not bots.
3. Switch to `enforce`. Rollback: `monitor` (no deploy of code needed, just the variable).
4. Update the privacy notice and cookie copy: Turnstile sends visitor signals to Cloudflare on
   signup, login, reset, lead and join pages.

## Phase 2 and 3: email OTP

1. `AUTH_OTP_MODE=signup`. Watch `lifekeel_otp_chain_state_total{delivery}`,
   `lifekeel_otp_email_latency_seconds`, `lifekeel_otp_verify_total{result}` and support
   tickets for a week.
2. `AUTH_OTP_MODE=signup_login`. TOTP users still get `mfa_required` and never an email code.
3. The retention worker sweeps unverified signups after 7 days
   (`jobs/pending-registrations.ts`).
4. Rotation: set `OTP_PEPPER_PREVIOUS`/`OTP_PEPPER_PREVIOUS_ID` to the old values and a new
   `OTP_PEPPER` + `OTP_PEPPER_ID`; remove the previous ones after 30 minutes (chain lifetime).

## Phase 4a: R2 infrastructure (no R2 writes yet)

Pre-production checklist (CLOUDFLARE_INTEGRATION.md §10), all required before 4b:

- [ ] Cloudflare DPA signed and Cloudflare added to the processor register as a **storage**
      sub-processor; ARCHITECTURE.md §11 already describes the data flow.
- [ ] Privacy notice updated (documents stored with Cloudflare R2, EU jurisdiction).
- [ ] No Cloudflare content-inspection or AI feature enabled on these buckets; no R2 event
      notification pointed at any model.
- [ ] Legal confirmation on HEVC patent exposure for server-side HEIC decoding (§12 item 2).

Buckets (EU jurisdiction, all private, `r2.dev` off, no custom domain):

```bash
for b in lifekeel-quarantine lifekeel-clean lifekeel-vault; do
  wrangler r2 bucket create "$b" --jurisdiction eu
done
# Quarantine: browser PUT only, from the app origins.
wrangler r2 bucket cors set lifekeel-quarantine --jurisdiction eu --file - <<'JSON'
{"rules":[{"allowed":{"origins":["https://app.lifekeel.co.uk","https://app.lifekeel.si"],"methods":["PUT"],"headers":["content-type"]},"maxAgeSeconds":600}]}
JSON
# Clean: GET from the app origins (in-page preview). Vault: no CORS.
wrangler r2 bucket cors set lifekeel-clean --jurisdiction eu --file - <<'JSON'
{"rules":[{"allowed":{"origins":["https://app.lifekeel.co.uk","https://app.lifekeel.si"],"methods":["GET"]},"maxAgeSeconds":600}]}
JSON
# Quarantine lifecycle: delete after 1 day, abort incomplete multipart after 1 day.
wrangler r2 bucket lifecycle add lifekeel-quarantine quarantine-expiry --expire-days 1 --jurisdiction eu
wrangler r2 bucket lifecycle add lifekeel-quarantine abort-mpu --abort-multipart-days 1 --jurisdiction eu
```

(Check `wrangler r2 bucket cors set --help` for the JSON shape your wrangler version expects;
the dashboard is equivalent.)

API tokens (R2 → Manage API tokens), one per job, each scoped to its buckets:

| Token | Permission | Buckets | Holder |
|---|---|---|---|
| `r2-presign` | Object Read & Write | quarantine | API service account |
| `r2-serve` | Object Read only | clean | API |
| `r2-delete` | Object Read & Write | clean | API |
| `r2-vault` | Object Read & Write | vault | API |
| `r2-scan` | Object Read & Write | quarantine, clean | **scan worker service account only** |

Store each as `lifekeel-r2-<name>-access-key-id` / `-secret-access-key` in Secret Manager and
add the matching `R2_<NAME>_ACCESS_KEY_ID` / `R2_<NAME>_SECRET_ACCESS_KEY` lines to the
`secrets:` block of the service that holds it. `R2_ACCOUNT_ID` and `R2_JURISDICTION=eu` are
Variables.

ClamAV: a `clamd` service with `freshclam` refreshing at least daily and `MaxThreads` equal to
total worker concurrency. Definitions older than 48 h make every scan an error (never clean).

Scan worker (`lifekeel-scan-worker`): same image as the API, command
`node apps/api/dist/scan-worker.js`, min-instances 1, **CPU always allocated**, concurrency 1,
4 vCPU / 8 GiB to start, its own service account holding only `r2-scan`, Mongo, Redis and
`CLAMD_HOST`, VPC egress limited to R2, ClamAV, MongoDB and Redis. It needs no JWT secret.
`/health` is its probe; `/metrics` honours `METRICS_SCRAPE_TOKEN`. HEIC needs `sharp` built
against `libvips` with `libheif` + `libde265` (`SHARP_FORCE_GLOBAL_LIBVIPS=1`); without it HEIC
uploads stay in `scan_error` (retried) rather than being lost.

Object backup (§7.14): nightly copy of `lifekeel-clean` and `lifekeel-vault` to an EU Cloud
Storage bucket in the existing GCP project, deletes not propagated for the backup window
(default 30 days, recorded in docs/data-retention.md), `age`-encrypted. Run a restore drill
(`mongodump` + objects from the same window, then the consistency report and erasure-journal
replay) and record it before 4b.

## Phase 4b: R2 for allow-listed tenants

1. API: `DOCUMENTS_STORAGE=r2`, `DOCUMENTS_R2_TENANTS=<internal tenant ids>`.
2. Real-R2 browser matrix (MinIO can't establish this): direct upload from Chrome, Safari,
   Firefox, iOS and Android WebViews including the CORS preflight; presigned GET preview.
3. EICAR through the real pipeline: status `infected`, nothing in clean.
4. Widen the allow-list; `*` when ready. Rollback: unset `DOCUMENTS_STORAGE` — new uploads go
   back to GridFS and R2 documents stay readable through the seam. **Keep the R2 keys and the
   scan worker running** while any R2 document exists: reads, deletes and erasure of those
   documents still need them.

## Phase 4c: vault in R2

`VAULT_STORAGE=r2` (API holds `r2-vault`). New vault uploads store ciphertext in
`lifekeel-vault`. Migration of existing vault blobs is copy-and-checksum only (never decrypt);
script not included in this release.

## Phase 5 (not in this release)

GridFS → R2 backfill through the same validation and scan, then retire GridFS reads only when
every §7.9 criterion holds. Mailbox attachments (`jobs/email-scan.ts`) still write GridFS — a
tracked known gap.

## Alerts to wire (§11.3)

Oldest `scan_queued` older than 5 minutes (`lifekeel_doc_scan_queue_age_seconds > 300`), any
`lifekeel_doc_stuck_total`, `lifekeel_clamav_definitions_age_seconds > 172800`,
`lifekeel_quota_drift_bytes > 0`, any `lifekeel_doc_scan_total{result="infected"}` (info),
OTP verify failure ratio and siteverify failure ratio spikes.
