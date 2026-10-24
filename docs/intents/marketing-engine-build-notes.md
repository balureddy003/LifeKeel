# Marketing engine, steps 2 to 6: build notes for any agent

Shared context for intents 15 to 19. Read this first, then the intent you were given.
Each intent is self-contained for scope and tests; this file holds what they have in common.

## Goal and order

Make LifeKeel's marketing and social engine attractive, self-learning, low-cost and reusable,
measured by **signups**, with **site visits per post** as the early signal (traffic is about
100 landing views a month, so signups alone cannot steer yet).

| Step | Intent | Depends on |
|---|---|---|
| 1 (done) | LinkedIn version fix (PR 226) and daily canary (PR 227) | — |
| 2 | [15 per-post tagging and weekly table](15-per-post-tagging-and-weekly-table.md) | main |
| 3 | [16 minimal Content Studio](16-minimal-content-studio.md) | 15 (records format on the post) |
| 4 | [17 invite and share loop](17-invite-and-share-loop.md) | none (parallel with 15 and 16) |
| 5 | [18 distribution playbook](18-distribution-playbook.md) | none (docs only) |
| 6 | [19 learner and weekly brief](19-learner-and-weekly-brief.md) | 15, 16, and about 500 visits a month |

Dropped for now: a multi-armed bandit, AI-proposed briefs, a Briefs panel, a Learning tab.
Connect all six platforms (Bluesky, LinkedIn, X, Threads, Instagram, Facebook) but plan for
2 or 3 active ones initially.

## Rules that bind every change (CLAUDE.md)

1. **Trust tiers.** No autonomous public or irreversible action. Publishing stays human-approved
   (the approve-the-week content hash). `NEVER_AUTONOMOUS` keeps `marketing.publish`,
   `social.post`, `marketing.profile_update`. Do not add a caller of `ConnectorActionExecutor`
   without editing the allow-list in `apps/api/src/__tests__/trust-tier-gate.test.ts`.
2. **No regulated advice.** All public text passes `checkCopy` (`marketing/copy-guard.ts`) and the
   advice-rule test. Facts come only from the live claims registry (`claims.ts`, 29 live claims).
   No "buy/switch", no named providers, no savings promises, no invented numbers or testimonials.
3. **Family content is never model training data or prompt input** for marketing. Public marketing
   text only. Any model call goes through the AI task gateway (`apps/api/src/ai/task-gateway.ts`,
   `definitions/ai-tasks.yaml`); register a task id or CI fails.
4. **Cost.** Free first. No new paid service, no new always-on server, optional integrations are
   read-only. Prefer deterministic code over model calls.
5. **One concern per PR.** Draft PRs while iterating (CI skips drafts). Run
   `pnpm turbo run typecheck lint test build` once at the end. Human review and manual deploy stay.
6. **Plan first** (plan mode) for anything touching more than 2 or 3 files; get sign-off before code.

## Where things live

- UTM scheme: `apps/api/src/marketing/utm.ts` (`utmQuery`, `attributionKey`, token rule
  `^[a-z0-9][a-z0-9_.-]{0,63}$`). Build every link through it.
- Social link builder: `siteLink(channel, path, contentTag, campaign)` in
  `apps/api/src/routes/marketing-posts.ts`. Today `contentTag` is the brief id or blog slug.
- Weekly plan: `apps/api/src/marketing/content-plan.ts` (`planWeek`, 12 hard-coded `BRIEFS`).
  Post drafting: `draftPostText` and the `GENERATE_SYSTEM` prompt in `routes/marketing-posts.ts`.
- Publishing: `marketing/social-publisher.ts`, the minute sweep `publishDueMarketingPosts`.
  `dry_run_mode` on the tenant stops real posts.
- Attribution: `marketing/journeys.ts` (first and last touch by source, campaign, content),
  `marketing/funnel.ts` (visit, cta_click, signup, profile, first_insight), `marketing/economics.ts`.
- Visits: public `POST /growth/events` (`routes/growth-events.ts`, `KNOWN_EVENTS` allow-list).
- Referral (PRD-112) in `routes/referrals.ts` and `db.ts`; family join (PRD-110) in
  `routes/family-group.ts` and web `app/invite/[code]`.
- Operator UI: `apps/web/src/app/operator/marketing/_components/` (Plan, Connections, Economics).
  Mission Control decisions: `apps/api/src/operator/mission-control.ts`.
- Erasure catalogue: `apps/api/src/erasure.ts` (`DELETABLE_COLLECTIONS`, `EXEMPT_COLLECTIONS`).
  Any new collection with per-tenant data must be listed in one of them.

## Local testing recipe (important)

The repo-root `.env` points at **PRODUCTION** Mongo and Redis. Never start the API from it as is.
In a bash subshell, source `.env`, then export:

```
MONGODB_URL=mongodb://127.0.0.1:27017 MONGODB_DB=<throwaway> REDIS_URL=redis://127.0.0.1:6379/<n> PORT=3011
AUTH_OTP_MODE=off TURNSTILE_MODE=off
```

and `unset` provider, Stripe, SendGrid and Azure/Anthropic/OpenAI/Groq/xAI keys. Set tenant
`automation.dry_run_mode: true` for anything that could post. Only kill your own servers by port;
a separate checkout runs its API on :3001. Drop the throwaway DB afterwards. Unit tests use fakes
and need none of this. Do not run `pnpm typecheck` or `pnpm build` while `next dev` is running.

## Definition of done for every intent

- Tests that fail without the change; `trust-tier-gate`, advice-rule and AI-gateway tests green.
- New collections registered in the erasure catalogue; new indexes in `db.ts`.
- Nothing verified against a live platform is claimed as verified (no tokens exist for X, Meta,
  LinkedIn or Threads in this environment). Say what was and was not exercised.
- PR template filled in (tier, advice check). Commit and PR attribution lines as the repo asks.
