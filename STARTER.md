# Starter: run LifeKeel locally with Podman

The fastest path from a fresh clone to the app running at <http://localhost:3002>.
MongoDB and Redis run in Podman; the API and web app run natively with pnpm so
hot reload and debuggers work. For CI-mirror checks see
[docs/local-testing.md](docs/local-testing.md); for debugging and seeded data see
[docs/local-debugging.md](docs/local-debugging.md).

| Service | URL | Runs in |
|---|---|---|
| Web (Next.js) | http://localhost:3002 | pnpm |
| API (Fastify) | http://localhost:3001 | pnpm |
| MongoDB 7 | 127.0.0.1:27017 | Podman |
| Redis 7 | 127.0.0.1:6379 | Podman |
| Mailpit (email inbox) | http://localhost:8025 | Podman |

## 1. Prerequisites

- Node 22.12+ (`node -v`)
- pnpm 8.15.5: `corepack enable && corepack prepare pnpm@8.15.5 --activate`
- Podman 5+ with Compose support (`podman compose` uses `podman-compose` or
  `docker-compose` under the hood):

```bash
brew install podman podman-compose
podman machine init        # first time only
podman machine start
```

## 2. Environment files

Both are gitignored by the `.env*` rule in `.gitignore`. Never commit them.

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

Then edit the root `.env`:

```bash
JWT_SECRET=<openssl rand -hex 32>               # required, 32+ chars
SETTINGS_ENCRYPTION_KEY=<openssl rand -hex 32>  # 32-byte hex
MONGODB_URL=mongodb://127.0.0.1:27017
MONGODB_DB=lifekeel
REDIS_URL=redis://127.0.0.1:6379
CORS_ORIGIN=http://localhost:3002

# Email to Mailpit (see "Testing email" below)
MAILPIT_URL=http://localhost:8025
SENDGRID_API_KEY=SG.local-mailpit-placeholder
SENDGRID_FROM_EMAIL=accounts@lifekeel.test
EMAIL_VERIFICATION_ENABLED=true
```

Everything else (LLM keys, Google OAuth, Stripe test keys, VAPID) is optional
locally; the features that need them stay off until set. See the comments in
`.env.example`.

## 3. Start the backing services

```bash
podman compose -f compose.local.yml up -d
podman compose -f compose.local.yml ps      # mongodb, redis, mailpit "Up"
```

`compose.local.yml` uses fully qualified image names (`docker.io/library/...`)
because Podman does not default to Docker Hub, and binds ports to 127.0.0.1
only. It also works with `docker compose`.

## 4. Install, build, run

```bash
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@lifekeel/api...   # builds packages/* the API imports

pnpm --filter @lifekeel/api dev:watch   # terminal 1, http://localhost:3001
pnpm --filter @lifekeel/web dev         # terminal 2, http://localhost:3002
```

`pnpm debug` runs both with the Node inspector open (ports 9229/9230).

## 5. Check it works

```bash
curl -s localhost:3001/health         # "detectors": 9
curl -s localhost:3001/health/ready   # mongodb + redis "connected"
```

Open <http://localhost:3002> and sign up with any address (use a `.test`
domain, e.g. `you@lifekeel.test`). For seeded demo data without signing up,
use the demo token described in
[docs/local-debugging.md](docs/local-debugging.md#see-the-app-with-data).

## Testing email

With `MAILPIT_URL` set, every email the API sends (verification, password
reset, family invites, reminders, lifecycle mail) is delivered to Mailpit
instead of SendGrid. Open <http://localhost:8025> to read it and click its
links.

- The API logs `Mailpit dev transport enabled` at boot when it is active.
  Restart the API after changing `.env`; it is read only at startup.
- `SENDGRID_API_KEY` must be set (any placeholder) or senders skip before
  sending. With `MAILPIT_URL` set, nothing reaches SendGrid.
- The API refuses to boot if `MAILPIT_URL` is set with `NODE_ENV=production`
  or points at anything other than localhost/127.0.0.1/[::1]
  (`apps/api/src/dev/mailpit.ts`).
- Quick checks: sign up (verification email), then use "Forgot password" on
  the sign-in page (reset email). `curl -s localhost:8025/api/v1/messages`
  lists the inbox; `curl -X DELETE localhost:8025/api/v1/messages` clears it.
- Without Mailpit, unset `MAILPIT_URL`, `SENDGRID_API_KEY` and
  `EMAIL_VERIFICATION_ENABLED`: accounts are then auto-verified and email is
  skipped with a log warning.

### Email templates

Every email uses one branded layout, `apps/api/src/email/layout.ts`
(`renderEmail`): sky hero with the logo, a white body card, a brass button,
and a footer with Support, Privacy, Terms and, when relevant, Manage
notifications and Unsubscribe. Colours come from the website's light theme
(`apps/web/src/components/landing/landing.css`); fonts name the site's faces
first with system fallbacks, and nothing is loaded from a font server.

To see all of them at once, with sample data:

```bash
pnpm --filter @lifekeel/api email:preview   # sends 20 emails to Mailpit
```

The logo is loaded from `${LIFEKEEL_URL}/icon-192.png`, so keep the web app
running while previewing. In `bodyHtml`, pass any user-supplied value through
`escapeHtml`; the layout escapes everything else.

## Stop and reset

```bash
podman compose -f compose.local.yml down       # stop, keep data
podman compose -f compose.local.yml down -v    # stop and wipe MongoDB data
podman exec -it lifekeel-local-mongodb-1 mongosh lifekeel   # inspect data
```

## Gotchas

- **Port already in use.** Another project's Redis/Mongo/Mailpit on
  6379/27017/8025/1025 will block startup. `lsof -nP -iTCP:6379 -sTCP:LISTEN` finds it.
- **Don't run `pnpm typecheck`/`pnpm build` while `next dev` is running.** It
  overwrites `apps/web/.next`; the page then renders unstyled. Stop the dev
  server, `rm -rf apps/web/.next`, restart.
- **"1 Issue" hydration warning in the Next.js overlay** mentioning a
  `chrome-extension://` script is caused by a browser extension editing the
  page before React loads, not by the app. An incognito window without
  extensions does not show it.
- **`/health/ready` reports `"mode": "cloud"`.** That is the storage adapter
  label (MongoDB rather than SQLite), not the deployment mode. The API still
  runs in `dev` deployment mode unless `LIFEKEEL_DEPLOYMENT_MODE` is set.
- **"cannot find module '@lifekeel/x'"** when running tests inside one
  package means a sibling's `dist/` is missing. Run from the repo root via
  turbo (see CLAUDE.md).
