# Staging environment for agent and tester testing

| Field | Value |
|---|---|
| Document ID | LK-RB-007 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Principal developer (role) |
| Approver | IMS manager (role) |
| Approved | — |
| Next review | — |

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
| Google Cloud project | The existing project, `dyocense-502208`; every staging resource is prefixed (see "Decision") | Decided by the owner on 2026-11-08. A separate project would have given separate IAM and secrets; the guardrails below replace that. |
| API | Cloud Run `lifekeel-api-staging` | Built from the same Dockerfile and image process as production, min instances 0. |
| Jobs | Optional at first | Needed for the digest and reminders; see "Time and jobs". |
| Database | Its own MongoDB database and credentials | Never the production connection string. |
| Redis | Its own instance or a separate database | Same rule. |
| Web | A separate Firebase Hosting site or a preview channel | Build with `NEXT_PUBLIC_API_URL` pointing at the staging API. The deploy step pins the API origin into the CSP, so the staging build needs its own value. |
| Mail | The staging mail sink (built, see below) | Nothing leaves the database. |

## Decision: same project, prefixed names (2026-11-08)

Staging lives in the existing Google Cloud and Firebase project (`dyocense-502208`). Nothing
separates it from production except names and permissions, so those matter:

| Resource | Production | Staging |
|---|---|---|
| Cloud Run API | `lifekeel-api` | `lifekeel-api-staging` |
| Cloud Run jobs | `lifekeel-jobs` | `lifekeel-jobs-staging` (later) |
| Secrets | `lifekeel-*` | `staging-*` (own copy of each one staging needs; none shared) |
| Container images | `lifekeel-docker/api` | same repository, tags prefixed `staging-` |
| Firebase Hosting | sites `lifekeel`, `lifekeel-landing-uk`, `lifekeel-landing-si` | a new site `lifekeel-staging` in the same Firebase project, as a new target in `apps/web/.firebaserc` |
| Database | `lifekeel` | a separate database name and its own user, `lifekeel_staging` |
| Service accounts | existing deploy accounts | a new staging runtime account and a new staging deploy account |

Guardrails that replace project isolation (all part of the outline below, none created yet):

- The staging runtime account is granted access to `staging-*` secrets one by one, never at
  project level, and has no access to any `lifekeel-*` secret. Same for the staging deploy
  account, which must not be able to deploy `lifekeel-api` or the production hosting sites.
- The staging deploy workflow targets only the staging service and site by name and has its own
  GitHub environment. It must not reuse the production environment or its approval.
- The staging database user can reach only the staging database.
- Billing, quotas and logs are shared with production. Give the staging service a low
  max-instances and a budget alert so a test loop cannot starve or bill production.
- Resource naming is the only visible boundary, so the acceptance checks include listing
  services and secrets and confirming each staging resource carries the prefix.
- The mail sink already refuses to start on a production host, which still protects mail if a
  setting is copied across by mistake. It does not protect against a staging service being
  pointed at the production database; the separate database user is what prevents that.

## Deploying staging (workflow)

`.github/workflows/deploy-staging.yml` deploys the staging API and web app. Run it from the Actions tab:
**Deploy staging**, "Use workflow from: main", then put the commit in `ref` (default `main`). Tick `api`
and `web` as needed. It never runs on a push, and it refuses any branch other than main.

What keeps it apart from production:
- It uses its own GitHub environment, `staging`. It never reads the `production` environment or its secrets.
- The service name `lifekeel-api-staging` is written in the file, not a setting.
- The API step updates the image only (`gcloud run deploy --image`). The settings and secrets on the staging
  service are left alone, so set them once by hand and they stay.
- The web step builds against `STAGING_API_URL`, refuses an empty value or a `lifekeel.co.uk` / `lifekeel.si`
  host, puts that origin in the content-security policy, and publishes only the `staging` Firebase site.
- `deploy-web.yml` (production) now names its three sites (`family`, `landing-uk`, `landing-si`). Before this
  it used `--only hosting`, which also published the production build to the staging site and broke it.
  `apps/api/src/__tests__/deploy-workflows.test.ts` fails if either rule slips.

Set these on the `staging` environment (Settings, Environments) before the first run:

| Kind | Name | Value |
|---|---|---|
| Variable | `STAGING_GCP_PROJECT_ID` | the project that holds staging (same as production for now) |
| Variable | `STAGING_GCP_REGION` | optional; defaults to `us-central1` |
| Variable | `STAGING_API_URL` | the staging Cloud Run URL |
| Variable | `STAGING_FIREBASE_PROJECT_ID`, `STAGING_FIREBASE_SITE` | optional; default to the project above and `lifekeel-staging` |
| Variable | `STAGING_GCP_WORKLOAD_IDENTITY_PROVIDER`, `STAGING_GCP_DEPLOY_SERVICE_ACCOUNT`, `STAGING_FIREBASE_DEPLOY_SERVICE_ACCOUNT` | preferred sign-in, no long-lived key |
| Secret | `STAGING_GCP_SA_KEY`, `STAGING_FIREBASE_SA_KEY` | fallback only, used when no workload identity provider is set |

Owner action, not done by the workflow: the `production` environment has no required reviewers. Add one under
Settings, Environments, production, "Required reviewers", so a production deploy waits for a person.

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

## Time and jobs (built, off until you switch it on)

The 14-day join expiry and the monthly digest depend on time, so an agent cannot reach them by
waiting. `apps/api/src/staging/test-controls.ts` adds two staging-only calls. They add no
product behaviour; they only set up time.

Switch on with `STAGING_TEST_CONTROLS=on` on the staging API service (and nowhere else). It
refuses to start unless the mail sink is on, the environment is `staging`, the token is long
enough and no production host is configured, so a digest run can never send real mail. Both
calls need the `X-Staging-Token` header, are listed as group F public routes, and do not exist
when the setting is off.

- `POST /staging/control/age-join-request` `{ "email": "kai@example.test", "days": 15 }`
  moves a pending request back 15 days (1 to 60). Only `example.test` and `example.com`
  addresses are accepted. Then ask for the organizer's request list: the normal code removes
  expired requests.
- `POST /staging/control/run-digest` `{ "cadence": "monthly", "now": "2027-03-01T08:00:00Z" }`
  runs the digest job once as of that date and returns the counts. Without `"tenant_id"` it
  runs over every family on staging (slow once there are many; each gets a digest in the
  sink), so pass `"tenant_id": "<the family's tenant>"` (from `GET /auth/me`) to run one. By default it records a sweep at that date first, because the digest refuses to send
  without a recent one; pass `"fresh_sweep": false` to prove it holds back instead. Call it with
  `now` in consecutive months to see the "not yet seen by every adult" reminder stop after two.
  Each window sends once per person, so repeat calls in the same month send nothing new.

Mail from a run lands in the mail sink as usual.

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
| Dictation with the phone keyboard | | Yes, on real phones (the app has no voice feature of its own) |
| Contrast, tap size, screen reader | Partly (browser measurements) | Yes |

## Outline for the owner (adapt and test; not run)

1. Confirm the staging web address and who may deploy (the project question is decided).
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
- No production secret is readable by the staging accounts (try it: a staging account asking for a `lifekeel-*` secret must be refused).
- Production behaviour is unchanged: `/staging/mail` returns 404 there.

## Known limits

The sink changes how mail is delivered, so staging differs from production in exactly the
part the sink replaces. Keep a short list of production-only checks for a human, and keep
staging free of real people.
