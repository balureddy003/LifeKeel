# Running the checks locally

What CI runs, and how to run the same things on your machine. The commands were run while
writing this guide, except the Docker commands (marked) and the corepack line, which could not be
run here.

## What each check is for

| Check | Catches | Needs |
|---|---|---|
| `pnpm typecheck`, `pnpm lint` | type and style errors | Node |
| `pnpm test` (unit) | logic bugs in the API, engine, platform | Node |
| API integration tests | real Mongo/Redis behaviour fakes cannot show: the 10 `ml-tenant-isolation` tests, and `email-scan-fanout.integration` (queue delivery, the per-tenant lock, the enqueue dedupe) | MongoDB + Redis |
| `scripts/boot-smoke.sh` | **a bad deploy-time environment**: boots the built API with every optional deploy variable set to empty, as an unset repo variable is, and requires `/health/ready` | built API + MongoDB + Redis |
| Python service tests | the encoder service's request handling | Python 3.11 (stdlib only) |
| Image builds (`images.yml`) | a broken Dockerfile, a missing system package (Tesseract), an undeclared Python dependency, a model that was never baked in | Docker |
| `local-model-eval.js` | whether a given Ollama model is safe to use as the judge / email classifier | a running Ollama | (removed by the PR 42 cleanup, restored by PR 45; playbook gap G15)

Unit tests never start the server. The boot smoke test exists because two real bugs got through
them: a strict `true|false` setting rejected an empty deploy variable and crashed the API at boot, and
an empty `CORS_ORIGIN` made every request return 500. The smoke script reads the variable names from
`deploy-api.yml`, so a variable added there later is covered without editing the script.

## 1. Prerequisites

- Node 22 and pnpm 8.15.5 (`corepack enable && corepack prepare pnpm@8.15.5 --activate`)
- Optional: Python 3.11 (service tests), Docker (images, and the easiest way to get MongoDB and Redis)

```bash
pnpm install --frozen-lockfile
```

## 2. MongoDB and Redis

**With Docker** (uses the compose file already in the repo):

```bash
docker compose -f apps/api/docker-compose.yml up -d mongodb redis
export MONGODB_URL=mongodb://127.0.0.1:27017 REDIS_URL=redis://127.0.0.1:6379
```

**Without Docker**: install `redis-server` from your package manager and download a `mongod` 7.x
binary (no install needed; this is what was used to verify this guide):

```bash
mkdir -p /tmp/mongo/data && cd /tmp/mongo
curl -fsSLO https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-7.0.14.tgz
tar xzf mongodb-linux-x86_64-ubuntu2204-7.0.14.tgz --strip-components=1 --wildcards '*/bin/mongod'
./bin/mongod --dbpath data --port 27099 --bind_ip 127.0.0.1 --fork --logpath mongod.log
redis-server --port 6390 --save "" --appendonly no --daemonize yes
export MONGODB_URL=mongodb://127.0.0.1:27099 REDIS_URL=redis://127.0.0.1:6390
```

(Pick the build matching your OS from <https://www.mongodb.com/try/download/community>.)

## 3. Unit and integration tests

```bash
export MONGODB_DB=lifekeel_test JWT_SECRET=test-secret-not-for-production NODE_ENV=test
pnpm typecheck && pnpm lint
pnpm test          # runs through turbo, which builds the packages the tests import first
```

- Run tests from the **repo root** with `pnpm test`. Running `vitest` inside one package can show false
  "cannot find module `@lifekeel/...`" errors when a sibling package has not been built (see CLAUDE.md).
- Without MongoDB/Redis the 10 `ml-tenant-isolation` tests fail (expected) and the fan-out integration
  test is skipped. Set `CI=true` to make the integration test **fail** instead of skip when a service
  is missing, which is what CI does so an infrastructure problem cannot hide as a pass.
- One file: `cd apps/api && pnpm vitest run src/__tests__/email-scan-fanout.integration.test.ts`.
- With MongoDB and Redis up and `CI=true`, the full API suite passes in under three minutes
  (1,144 tests, 0 failed, when this guide was written). If it seems to hang, check that Redis is
  actually running: tests that need it wait on the connection.

## 4. Boot smoke test

```bash
pnpm build
scripts/boot-smoke.sh        # uses MONGODB_URL / REDIS_URL from step 2
```

Expected: it lists the empty deploy variables it set, then
`OK: API booted with empty deploy variables and /health/ready is 200`. On failure it prints the
last 40 log lines. Options: `SMOKE_PORT` (default 3991), `SMOKE_TIMEOUT_S` (default 90).

To boot a built **image** instead of `node` (needs Docker; not run locally while writing this):

```bash
docker build -f apps/api/Dockerfile -t lifekeel-api:local .
SMOKE_IMAGE=lifekeel-api:local scripts/boot-smoke.sh
```

## 5. Python service tests

```bash
python3 -m unittest discover -s infra/encoder-service -p 'test_server.py' -v
```

No torch or model needed: the model is loaded lazily and the tests use a fake.

## 6. Images (Docker; mirrors `.github/workflows/images.yml`)

These have not been run on a machine without Docker; CI is where they are first exercised.

```bash
# API image, then check Tesseract (local document OCR depends on it)
docker build -f apps/api/Dockerfile -t lifekeel-api:local .
docker run --rm --entrypoint tesseract lifekeel-api:local --version

# Ollama image with a tiny model baked in, then confirm the model is there
docker build -f infra/local-judge/Dockerfile --build-arg MODEL=qwen2.5:0.5b -t lifekeel-local-judge:local infra/local-judge
docker run -d --name judge -p 11434:11434 lifekeel-local-judge:local
curl -s localhost:11434/api/tags          # should list qwen2.5:0.5b

# Encoder image, dependencies only (skips the ~1.7 GB model), then its tests inside the image
docker build -f infra/encoder-service/Dockerfile --build-arg BAKE_MODEL=false -t lifekeel-encoder:local infra/encoder-service
docker run --rm -v "$PWD/infra/encoder-service:/t" -w /t lifekeel-encoder:local python -m unittest test_server -v
```

## 7. Running the models locally

**Ollama (judge, email classifier, OCR fields).** Install Ollama, then:

```bash
ollama pull qwen2.5:7b            # or qwen2.5:3b; do not go below 3b (1.5b approved unsafe copy)
export LOCAL_JUDGE_BASE_URL=http://127.0.0.1:11434 LOCAL_JUDGE_MODEL=qwen2.5:7b
pnpm build
node apps/api/dist/eval/local-model-eval.js   # exits non-zero if a gate fails; takes several minutes on CPU
```

`apps/api/src/ocr` also needs the Tesseract binary (`apt install tesseract-ocr tesseract-ocr-eng`).

**Encoder service (email relevance).** See `infra/encoder-service/README.md`. In short:

```bash
cd infra/encoder-service
python3 -m venv venv && venv/bin/pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
venv/bin/pip install -r requirements.txt
PORT=8080 venv/bin/python server.py      # /healthz is 503 until the model loads (20s warm, 2.5+ min cold)
# then, for the API:
export EMAIL_ENCODER_URL=http://127.0.0.1:8080 EMAIL_ENCODER_MODE=shadow   # or gate
```

Start with `shadow` (no effect on results) and watch
`lifekeel_email_encoder_total{outcome="encoder_missed"}` on the metrics endpoint.

## 7b. The web app under the production CSP

The deployed site sends `script-src 'self'`, so a page that works in `next dev` can be
blank in production (inline scripts blocked). To check the static export the way Firebase
serves it, and the landing page's first-load JS budget:

```bash
pnpm --filter @lifekeel/web run build:export
node scripts/externalize-inline-scripts.mjs apps/web/out
node scripts/check-landing-size.mjs apps/web/out
node scripts/serve-static-csp.mjs apps/web/out apps/web/firebase.json   # http://localhost:8770
```

Open the page and watch the console for `Refused to ...` messages. CI runs the size check
against the ordinary build (`node scripts/check-landing-size.mjs --next apps/web/.next`).

## 7c. Email OTP without a mailbox

QA/e2e harnesses cannot read real email, and addresses like `example.com` can
never receive it. Two local paths:

- **Mailpit** (`MAILPIT_URL`) captures every outbound mail to a local inbox —
  see `compose.local.yml` and `apps/api/src/dev/mailpit.ts`.
- **`LIFEKEEL_TEST_OTP_CODE=<6 digits>`** makes every issued OTP that fixed
  code, so a flow can be completed end-to-end without touching the mailbox at
  all. Honoured only when `NODE_ENV` is unset/`development`/`test`; setting it
  outside dev is a boot violation (`evaluateOtpBoot`), so it cannot weaken a
  real deployment.

## 8. What these checks do not cover

- Real traffic, real data, and load. No load test has been run on a real instance type.
- Model quality beyond the small synthetic sets in `apps/api/src/**/__fixtures__` and
  `infra/encoder-eval`.
- Cloud Run behaviour: IAM auth, cold starts, autoscaling. The deploy workflows have not been run end to end.
