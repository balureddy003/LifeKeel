# Running and debugging locally

How to bring the stack up, attach a debugger, and see the app with real data.
Setup detail lives in [CONTRIBUTING.md](../CONTRIBUTING.md) ("First 15
minutes") and [local-testing.md](local-testing.md) (the CI-mirror checks);
this doc is the day-to-day loop.

## Bring the stack up

```bash
docker compose -f apps/api/docker-compose.yml up -d   # MongoDB + Redis
pnpm --filter @lifekeel/api dev                        # http://localhost:3001
pnpm --filter @lifekeel/web dev                        # http://localhost:3002
```

The API sources the root `.env`; the web reads `apps/web/.env`
(`NEXT_PUBLIC_API_URL` — `http://localhost:3001` for local work). Check the
API came up clean: `curl localhost:3001/health` should report the 9 loaded
`family.*` detectors; `/health/ready` reflects Mongo/Redis connectivity.

## Breakpoints

Two working setups, pick one:

- **`pnpm debug` (root).** Runs both apps in watch mode with the inspector
  open — API on `--inspect=9229`, web (Next) on `--inspect=9230`. Attach from
  `chrome://inspect`, `node --inspect`, or your editor's attach config.
- **`.vscode/launch.json` (committed).** Press F5 and pick a config:
  *Debug API* (`dev:watch`), *Debug Web Server* (auto-attaches Chrome when
  Next reports ready), *Debug Web Browser* (client-side breakpoints at
  :3002), or the *Debug Web + API* compound for both at once.

The API runs under `tsx watch`, so sourcemaps work and edits restart it —
breakpoints survive the reload.

## See the app with data

Booting fresh gives you an empty app that wants onboarding + connectors.
Two ways past that:

**Real local signup (full UI).** Sign up at `localhost:3002` normally — the
user lands in your local MongoDB, and `email_verified` is set automatically
when `EMAIL_VERIFICATION_ENABLED` is unset (the default locally), so no SMTP
is needed. This is the path for working on onboarding, forms, and anything
the API serves from real documents.

**Demo token + sandbox seed (populated, no setup).** The API can mint a demo
JWT whose `demo: true` claim activates sandbox mode server-side — every
sandboxed route returns seeded family data (3 goals, 10 insights, 3
workflows, verified moments, attribution, trust metrics):

```bash
TOKEN=$(curl -s localhost:3001/auth/demo-token | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s localhost:3001/insights  -H "Authorization: Bearer $TOKEN"
curl -s localhost:3001/goals     -H "Authorization: Bearer $TOKEN"
curl -s localhost:3001/workflows -H "Authorization: Bearer $TOKEN"
```

- `?sandbox=1` on the query string (or `x-sandbox-mode: true`) activates the
  same seed on a non-demo token. Demo tokens are disabled in production
  unless `ALLOW_DEMO_TOKENS=1`.
- Insight approve/dismiss under sandbox persists per tenant **in memory** —
  restart the API and it resets. That's by design: seeded insight ids don't
  exist in Mongo.
- The demo guard blocks `GET /connector-credentials` for demo tokens — so
  sandbox data can never leak real connector secrets even if the demo
  tenant's DB has them.
- In the web UI, pasting the token into `localStorage['lifekeel_token']`
  authenticates API calls as the demo tenant, but `family-auth` user
  metadata will be missing — pages depending on it behave oddly. For UI
  work, real local signup is the fuller path; the demo token shines for API
  checks and screenshots (it's what the store-listing checklist uses).

## Inspect the data directly

```bash
docker exec -it $(docker ps -qf name=mongodb) mongosh lifekeel   # or your MONGODB_DB
#   db.insights.find().limit(5); db.users.find({}, {email:1, tenant_id:1})
docker exec -it $(docker ps -qf name=redis) redis-cli
#   KEYS *; LLEN <queue-name>
```

## iOS Simulator (headless — no interactive Xcode needed)

```bash
cd apps/mobile
./scripts/prepare-ios.sh                       # cap add + sync + plist + icons
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  CODE_SIGNING_ALLOWED=NO build

# Install + launch on a simulator — pick any available device:
xcrun simctl list devices available | grep iPhone
xcrun simctl boot "iPhone 17" 2>/dev/null || true
APP=$(find ~/Library/Developer/Xcode/DerivedData -name "App.app" \
  -path "*Debug-iphonesimulator*" | head -1)
xcrun simctl install booted "$APP"
xcrun simctl launch booted uk.co.lifekeel.app
xcrun simctl io booted screenshot /tmp/lifekeel-sim.png
```

The shell shows a **white screen for the first ~15–20 seconds** on cold
launch — that's the remote page loading `app.lifekeel.co.uk`, not a bug
(check `xcrun simctl spawn booted log show --last 30s --predicate 'process == "App"'`
for `domContentLoaded` to confirm the WebView is alive).

Region/locale for the Slovenia QA gate (regional redirect + Preferences
persistence — see `apps/mobile/README.md`):

```bash
xcrun simctl launch booted uk.co.lifekeel.app \
  -AppleLanguages "(sl)" -AppleLocale sl_SI
```

Android local builds need an SDK (`ANDROID_HOME`) — none is assumed; the
release workflow builds Android on the CI runner instead.

## End-to-end (Playwright)

```bash
cd apps/web
pnpm exec playwright install chromium webkit    # once
pnpm test:e2e                                   # boots local API + web, full device matrix
pnpm test:e2e --project=iphone                  # one device
```

## Gotchas worth remembering

- **Don't run `pnpm build`/`pnpm check` while `next dev` is running** — it
  overwrites `apps/web/.next` under the dev server and the page comes back
  unstyled. Stop dev, delete `.next`, restart.
- **Run tests from the repo root.** Per-package `vitest` fails with false
  "cannot find module" errors until sibling `dist/` outputs exist.
- API `pnpm dev`/`debug`/`start` all source the root `.env` — a stale
  variable there is the first thing to check when behaviour looks wrong.
- Integration tests that need real Mongo/Redis fail without the compose
  stack up (expected — see local-testing.md §3).
