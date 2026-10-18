# Infrastructure provisioning

How LifeKeel's production infrastructure gets created and wired to the domains.
The goal: **one operator with the right credentials runs
`./scripts/provision-infra.sh all` and gets a deployable stack** — any project,
any domain, re-runnable step by step.

Topology it produces (see `apps/web/firebase.json`):

| Host | Target |
|---|---|
| `lifekeel.co.uk`, `lifekeel.si` (+`www`) | Firebase landing sites (marketing only — app routes 302 to `app.*`) |
| `app.lifekeel.co.uk`, `app.lifekeel.si` | Firebase `lifekeel` site (the app) |
| `api.lifekeel.co.uk`, `api.lifekeel.si` | Cloud Run domain mappings → `lifekeel-api` |

## 0. One-time prerequisites (cannot be scripted)

1. A GCP/Firebase project with billing enabled (`dyocense-502208` for prod).
2. A GitHub repo with an environment named `Production`. Add a **required
   reviewer** at Settings → Environments → Production — that's the human
   approval gate the deploy workflows assume; the API can't set it.
3. Local auth — all plain terminal commands, no API keys to mint in consoles:

   ```bash
   gcloud auth login            # GCP project owner — covers gcloud + Firebase API calls
   gh auth login                # repo admin — for the github step
   brew install hostinger/tap/hostinger   # first `hostinger` command opens browser sign-in
   gcloud auth application-default login \
     --scopes=https://www.googleapis.com/auth/siteverification,https://www.googleapis.com/auth/cloud-platform
   #   ^ only needed for the `verify` step (Cloud Run domain mappings).
   #     Skip it and verify domains in Search Console manually if preferred.
   ```

   Prefer not to install the Hostinger CLI? Export `HOSTINGER_API_TOKEN`
   (hPanel → API → create token) and the script uses the REST API instead.

## Step by step — what the script does

Each stage is idempotent and separately runnable: `./scripts/provision-infra.sh <step>`.

### `gcp` — project plumbing

Enables the APIs (`run`, `artifactregistry`, `secretmanager`, `firebasehosting`,
`siteverification`, `iam`), creates the `lifekeel-docker` Artifact Registry
repo, and creates two deploy service accounts:

- `github-deploy` — `run.admin`, `artifactregistry.writer`,
  `iam.serviceAccountUser`, `storage.admin` → exported to
  `deploy-out/gcp-sa-key.json` (becomes `GCP_SA_KEY`)
- `github-firebase` — `firebasehosting.admin` → `deploy-out/firebase-sa-key.json`
  (becomes `FIREBASE_SA_KEY`)

It also grants the default compute SA `secretmanager.secretAccessor`, since the
Cloud Run service mounts secrets without an explicit runtime SA.

### `secrets` — Secret Manager values

Creates every secret `deploy-api.yml` binds (`lifekeel-mongodb-url`,
`lifekeel-jwt-secret`, the Stripe/Google/OpenAI/VAPID set, …). Values come from
matching env vars — `JWT_SECRET=...` populates `lifekeel-jwt-secret` — so the
step is `JWT_SECRET=… MONGODB_URL=… ./scripts/provision-infra.sh secrets`.
Unset ones are created empty and warned about; Cloud Run stays unhealthy until
every bound secret has a version.

### `firebase` — hosting sites + custom domains

Creates the per-TLD landing sites (`lifekeel-landing-uk`,
`lifekeel-landing-si`) via the Firebase Hosting REST API — site IDs derive from
the domain, so new TLDs just extend `APEX_DOMAINS`. Then attaches:

- apex + `www` → its landing site
- `app.<domain>` → the `lifekeel` app site

For each attached host it reads `requiredDnsUpdates` — the authoritative record
list (verification TXT first if the domain isn't Google-verified yet, then the
A/CNAME targets) — and appends them to `deploy-out/dns-<domain>.json`.

### `verify` — domain ownership for Cloud Run

Cloud Run domain mappings refuse unverified domains. This step calls the Site
Verification API (`DNS_TXT` method), writes the token into the DNS plan, pushes
it to Hostinger immediately, and completes verification. If the ADC token lacks
the `siteverification` scope it prints the manual path (Search Console → add
property → TXT).

### `run-map` — `api.*` → Cloud Run

`gcloud beta run domain-mappings create` per domain. Requires the service to
exist (i.e. one successful `deploy-api` run) and the domain verified — hence
ordering: deploy API once on `*.run.app`, then map. Adds the
`api → ghs.googlehosted.com` CNAME to the plan.

### `dns` — push records to Hostinger

`PUT /api/dns/v1/zones/{domain}` with `overwrite: true` — replaces only the
(name, type) pairs the plan owns; MX and unrelated records survive. Validates
the payload first (`POST .../validate`).

Manual counterpart in hPanel: **disable Hostinger's CDN/proxy** on each domain —
it terminates TLS itself and blocks Firebase/Google cert issuance.

### `github` — Actions variables + secrets

Sets the vars the workflows read (`FIREBASE_PROJECT_ID`, `GCP_REGION`,
`LIFEKEEL_URL=https://app.<primary>`, `API_BASE_URL`,
`NEXT_PUBLIC_API_URL`, `CORS_ORIGIN` covering every `app.*` host) and uploads
the SA keys as `GCP_SA_KEY` / `FIREBASE_SA_KEY` / `GCP_PROJECT_ID` secrets.
Delete `deploy-out/` afterwards.

### `status` — verify

Digs every hostname so you can watch cutover.

## Deploy order (first time)

```
1. gcloud auth login + gh auth login + HOSTINGER_API_TOKEN export
2. ./scripts/provision-infra.sh gcp secrets github   # auth + registry + secrets
3. gh workflow run "Deploy API" -f ref=main          # creates lifekeel-api
4. ./scripts/provision-infra.sh firebase verify run-map dns
5. gh workflow run "Deploy" -f ref=main -f same_origin_api=true
6. Google OAuth console: add https://app.<domain>/auth/callback redirect URIs
```

## For a different project/domain set

Everything parameterizes through env vars — no code edits:

```bash
GCP_PROJECT=my-project APEX_DOMAINS="example.com" PRIMARY_DOMAIN=example.com \
APP_SITE=my-app RUN_SERVICE=my-api AR_REPO=my-docker GH_REPO=me/repo \
./scripts/provision-infra.sh all
```

## Day-2: upgrades and changes after the first deploy

Every step is idempotent — re-running only fills gaps. The upgrade workflows:

**Add a domain/TLD later** — append it and rerun the domain-facing steps:

```bash
APEX_DOMAINS="lifekeel.co.uk lifekeel.si lifekeel.de" \
  ./scripts/provision-infra.sh firebase verify run-map dns github
```

The landing site name derives from the domain, CORS_ORIGIN and the firebase.json
redirect list are regenerated from the same list — but note `firebase.json`'s
per-TLD `landing-*` blocks and the app-route redirect destination are per-domain
config, so a new TLD also needs a `landing-<tld>` block in `firebase.json` +
target in `.firebaserc` before the web deploy picks it up.

**Map a new subdomain to Cloud Run** (e.g. `hooks.lifekeel.co.uk`):

```bash
RUN_SUBDOMAINS="api hooks" ./scripts/provision-infra.sh run-map dns
```

**Rotate a Secret Manager secret** — export the new value and rerun; the step
adds a new version, and the next `deploy-api` run picks up `:latest`:

```bash
JWT_SECRET=new-value ./scripts/provision-infra.sh secrets
```

To force-pick-up without a full deploy:
`gcloud run services update lifekeel-api --update-secrets lifekeel-jwt-secret=lifekeel-jwt-secret:latest --region us-central1`.

**Rotate the deploy SA keys** — delete `deploy-out/gcp-sa-key.json` (and/or the
firebase one) and rerun `gcp github`. The step skips key creation while a key
file exists, so untouched keys aren't churned.

**Add a Secret Manager entry** — append the name to `SECRET_NAMES` in the script
*and* to the `secrets:` block in `deploy-api.yml`, then rerun `secrets`.

**Check for drift** — `provision-infra.sh status` compares every record in
`deploy-out/dns-*.json` against live DNS (`DRIFT` lines) and prints cert
provisioning state per host. Re-run `dns` to converge.

**Remove a domain** — deliberately manual (destructive): delete the custom
domain in Firebase console → Hosting, `gcloud run domain-mappings delete`, then
remove the records in Hostinger. The script never deletes DNS records — its
`overwrite: true` only replaces (name, type) pairs it owns, so removing a
domain from `APEX_DOMAINS` stops managing it without tearing anything down.

## Caveats the script can't cross

GCP billing, Firebase Blaze plan (multi-site requires it), the `Production`
environment reviewer toggle, Hostinger CDN disable, and OAuth consent/redirect
config in provider consoles.
