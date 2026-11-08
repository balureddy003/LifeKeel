# Staging environment for agent and tester testing

Status: design plus first code switch. Date: 2026-11-08. Nothing in this runbook has been
created or run. Steps that change Google Cloud, Firebase, GitHub or secrets are for the
owner to approve and run; they are written as an outline to adapt, not as tested commands.

## Why

LifeKeel has one environment: production. A read-only check on 2026-11-08 found only
`lifekeel-api` and `lifekeel-jobs` on Cloud Run in project `dyocense-502208`, serving
`app.lifekeel.co.uk` and `app.lifekeel.si`. The deploy workflows (`deploy-api.yml`,
`deploy-web.yml`) are production-only, and the API one is set to pause for approval (`environment: production`). There
is no staging service, no preview channel and no second database that the repo knows about.

Consequences for testing:

- Every test account an agent creates lands in the live database next to real families.
  "Fictional data only" is then a rule, not a boundary.
- Production holds keys that testing must not touch: `XAI_API_KEY` (approved only under the
  testing-phase exception, with no zero data retention), `OPENAI_API_KEY` (unreviewed in the
  processor registry), Stripe, and the Resend key.
- An agent cannot read a real inbox, so it cannot follow a confirm link, a login code or the
  approval email.

## What the repo cannot tell us (check before building)

- Whether production runs the latest `main`. The live image is a digest that cannot be mapped
  to a commit from the repo.
- Firebase Hosting: the `firebase` CLI was not signed in on the machine used for the check, so
  the hosting sites, headers (the microphone rule) and the landing redirect were not verified.
- How scheduled jobs are triggered. Cloud Scheduler is not enabled in the project.
- Whether `lifekeel.co.uk` is verified in Resend. The live `EMAIL_FROM` is
  `accounts@mail.lifekeel.co.uk`, not `wehelp@lifekeel.co.uk`.

## Target shape

| Piece | Staging | Notes |
|---|---|---|
| Google Cloud project | A separate project (recommended), e.g. `lifekeel-staging` | Separate IAM and secrets. Fallback: same project, services and secrets prefixed `staging-`. Owner decision. |
| API | Cloud Run `lifekeel-api-staging` | Built from the same Dockerfile and image process as production, min instances 0. |
| Jobs | Optional at first | Needed for the digest and reminders; see "Time and jobs". |
| Database | Its own MongoDB database and credentials | Never the production connection string. |
| Redis | Its own instance or a separate database | Same rule. |
| Web | A separate Firebase Hosting site or a preview channel | Build with `NEXT_PUBLIC_API_URL` pointing at the staging API. The deploy step pins the API origin into the CSP, so the staging build needs its own value. |
| Mail | The staging mail sink (built, see below) | Nothing leaves the database. |

## Settings that differ from production

| Setting | Staging value | Why |
|---|---|---|
| `LIFEKEEL_ENVIRONMENT` | `staging` | Required by the mail sink; it refuses to start otherwise. |
| `STAGING_MAIL_SINK` | `on` | Mail is stored, not sent. |
| `STAGING_TEST_TOKEN` | 24+ random characters, as a secret | Lets the agent read stored mail. |
| `LIFEKEEL_URL`, `LIFEKEEL_APP_HOSTS`, `CORS_ORIGIN` | The staging web address only | The sink refuses a production host here. Production CORS lists only the production hosts, so staging needs its own. |
| `EMAIL_VERIFICATION_ENABLED` | `true` | Testable now, because the agent can read the confirm link from the sink. |
| `AUTH_OTP_MODE` | As production wants it | Login codes also arrive by email, so the sink covers them too. |
| `TURNSTILE_MODE` | Off, or Cloudflare's published test keys | A bot check must not block an agent in staging. Never bypass it in production. |
| VAPID secrets | A staging key pair, own subject | `npx web-push generate-vapid-keys`. Push needs these or the switch is disabled. |
| `NEXT_PUBLIC_ON_DEVICE_VOICE` | `on` in the staging web build | Voice can still be previewed anywhere with `?voice=on`. |
| AI keys | Separate staging secrets only | See "AI in staging". |
| Stripe | Test-mode keys | Never live keys. |
| Resend | Not needed while the sink is on | The sink replaces sending. |

## AI in staging

Staging holds fictional data only, so the xAI testing-phase exception (recorded 2026-10-31)
covers using xAI there. Use a separate `staging-xai-api-key` secret, set
`LIFEKEEL_LLM_PROVIDER=xai` explicitly (otherwise the first configured provider wins and
`OPENAI_API_KEY` would come first), and keep the registry's rules on. Do not mount
`OPENAI_API_KEY` in staging. Do not copy production secrets into staging.

## Mail for agents (built)

`apps/api/src/staging/mail-sink.ts` keeps outgoing mail in a `staging_mail` collection and
serves it at `GET /staging/mail?to=<address>` with header `X-Staging-Token`. Guards, each
covered by a test that fails when the guard is removed:

- Off unless `STAGING_MAIL_SINK=on`.
- Refuses to start unless `LIFEKEEL_ENVIRONMENT=staging`.
- Refuses to start without a token of at least 24 characters.
- Refuses to start if `LIFEKEEL_URL` or `LIFEKEEL_APP_HOSTS` names a production host.
- The route exists, and is on the public-route list (group F), only when the sink is on.
- `to` is required, so the route cannot dump every message. Messages expire after 7 days.

Agent use: create the account or request, then poll
`GET /staging/mail?to=partner@example.com&since=<ISO time>` and open the first link in the
message.

What the sink does not test: Resend itself. Sender domain, SPF and DKIM, deliverability and the
real `From` address are only proven by sending real mail. Do that once by a human, from
production-like configuration, to an inbox they own.

## Time and jobs (not built)

The 14-day join expiry and the monthly digest depend on time and on jobs, so an agent cannot
reach them today. Proposed, each behind the same kind of guard as the sink (staging only,
token, refuses to start elsewhere):

- A way to run a named job once (digest, reminders, expiry purge) on demand.
- A way to move "now" forward for one tenant, or to create a request already dated 15 days ago.

These are new code and need review. They should not exist in a production build path.

## Data

- Seed two or three fictional households with known names: an organizer, a second adult, a
  child, a few policies and vehicles. Not built.
- A reset that is only reachable in staging. Not built.
- Never import production data.

## Who tests what

| Area | Agent in staging | Human |
|---|---|---|
| Join, approve, edit rights, records, confirm, reconfirm | Yes | |
| Confirm link, login code, approval email | Yes, through the sink | Real inbox once, with Resend |
| Digest, 14-day expiry | After the job and time switches exist | |
| Upload burst | Yes | |
| Push wiring (subscribe, server send attempt) | Yes, with staging VAPID keys | A real notification on a real phone |
| Microphone and on-device voice | | Yes, on real phones, including airplane mode |
| Contrast, tap size, screen reader | Partly (browser measurements) | Yes |

## Outline for the owner (adapt and test; not run)

1. Decide: separate project or same project; the staging web address; who may deploy.
2. Create the project or services, the database and Redis, and the staging secrets.
3. Create a Firebase Hosting site (or channel) for staging and add it as a target in
   `apps/web/.firebaserc`.
4. Add a deploy workflow for staging. It should deploy from `main` only, use its own
   environment name and secrets, and never reuse the production approval environment. This
   needs owner review, so it is not included here.
5. Set the staging settings above and deploy the API.
6. Check boot: the API logs "STAGING mail sink on". If it refuses to start, read the message.
7. Run the acceptance checks below.

## Acceptance checks

- The API starts with the sink on, and refuses to start when `LIFEKEEL_ENVIRONMENT` is
  `production` or the URL is a production host (try it on a throwaway run).
- `GET /staging/mail` without the token returns 401; with it and a `to`, returns that
  address's messages only.
- A new joiner's confirm link can be fetched and opened by an agent.
- No production secret exists in the staging project.
- Production behaviour is unchanged: `/staging/mail` returns 404 there.

## Known limits

The sink changes how mail is delivered, so staging differs from production in exactly the
part the sink replaces. Keep a short list of production-only checks for a human, and keep
staging free of real people.
