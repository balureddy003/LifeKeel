# LifeKeel — instructions for Claude Code (and any AI agent working here)

LifeKeel is the autonomous digital twin for your family. Full product vision,
current architecture, and phased roadmap: [ARCHITECTURE.md](ARCHITECTURE.md).
Read that before making any change that touches product direction, not just
this file.

## Repo map

```
apps/web      Next.js frontend (static-exported to Firebase Hosting).
              User-facing product. package name: @lifekeel/web
apps/api      Fastify backend. package name: @lifekeel/api
packages/*    Shared libraries apps/api depends on (see each package's
              own README.md and package.json "description" for its role).
detectors/, connectors/, definitions/, verticals/, detector-evals/,
category-table.yaml, scripts/fetch-yfinance.py
              Runtime resource files apps/api reads via path.join(ROOT, ...)
              at request/boot time — not just config, load-bearing.
```

Everything here was extracted from a larger monorepo (kairos-ai) on
2026-09-12, then trimmed to what LifeKeel actually needs. `SECURITY.md`
documents exactly what was removed and why, and the known gaps left behind
on purpose. Read it before assuming something absent was never built.

## The one rule that matters most: trust tiers for autonomous action

LifeKeel's vision explicitly includes an "Act" layer — Keel doing things on
the family's behalf, not just telling them things. **Never implement
autonomous execution of a financial, legal, medical, or otherwise
irreversible action without an explicit human approval gate**, regardless of
how confident the detector/model is. See ARCHITECTURE.md's trust-tier model
(Tier 0–3) before adding anything that calls an external provider, moves
money, or claims to act "on the family's behalf." When in doubt, the action
belongs one tier lower than you think it does.

## The second rule: never cross into regulated advice or arranging

A deliberate, durable business decision, separate from the trust-tier rule
above: **LifeKeel stays outside any activity that would require FCA/SEC-
style regulatory authorization** — giving personal recommendations on
retail investment/insurance products, arranging or advising on insurance
contracts, payment initiation — permanently, not as a stage the product
grows out of. This is not the same axis as the trust-tier rule: a pure
Tier 0 insight that never touches autonomous execution can still trip
this if its *content* reads as a personal recommendation rather than
information.

Concretely:
- Detector/insight copy and the assistant's output describe what's *on
  file* and estimate a possible gap — never "buy X," never name or steer
  toward a specific provider/policy, always point to "a licensed
  professional" / "compare quotes from multiple insurers" rather than
  acting as the intermediary. `detectors/family/*.yaml`'s
  `reasoning_template`/`actions` fields and `assistant.ts`'s
  `SYSTEM_PROMPT` already follow this pattern — match it in anything new,
  don't relax it.
- Never build a "here's a better policy, switch to this one" flow, even
  as a Tier 0/1 prepare-only draft — that's insurance *arranging*, a
  separate regulated activity from giving information. PRD-103's drafted-
  outreach mechanism stays scoped to "notify your existing provider,"
  never a product comparison or switch recommendation.
- When competitive or market research (see `docs/reviews/`) surfaces an
  idea that implies LifeKeel becoming more advice-like, or investing in
  compliance/audit infrastructure to support giving advice, the right
  response is narrowing scope back to informational — not building out
  the compliance machinery to support crossing the line. Compliance
  overhead avoided by staying out of regulated activity in the first
  place beats compliance overhead paid for after deciding to compete
  there.

## How the rules are enforced (not just stated)

- **Advice rule (second rule):** `packages/engine/src/__tests__/advice-rule.test.ts`
  fails CI if detector/playbook copy contains recommendation verbs or named
  providers. `.claude/settings.json` runs it as a PostToolUse hook
  (`scripts/hooks/advice-check.sh`) so Claude sees the failure immediately
  after editing that copy.
- **PRs:** `.github/pull_request_template.md` makes tier, advice check and
  eval coverage explicit. New work starts from `docs/templates/intent.md`.
- **Ask Keel prompt:** `apps/api/src/eval/__tests__/assistant-eval.test.ts` pins
  the `SYSTEM_PROMPT` guardrail clauses (always runs). `apps/api/src/eval/assistant-eval.ts`
  is a live adversarial eval (`node dist/eval/assistant-eval.js`, needs an LLM
  configured) run before changing the prompt or model; it measures how often
  raw answers would be blocked by the production output guard.
- **Skill:** `.claude/skills/add-detector` encodes the add-a-detector recipe.
- **Trust tiers (rule 1):** `apps/api/src/__tests__/trust-tier-gate.test.ts`
  allow-lists the only callers of `ActionExecutor` and requires each
  `execute()` to name `approvedBy`. Adding a caller means editing that list,
  which forces the tier question into review. It is a tripwire, not proof.

## Conventions

- **TypeScript**, strict mode, `pnpm` workspace, `turbo` for build
  orchestration. Root scripts (`pnpm build`/`typecheck`/`lint`/`test`) run
  everything via `turbo run <task>` — never run `tsc`/`vitest` directly
  inside a package if the task depends on sibling packages' build output
  (see gotcha below).
- No package in `packages/*` has its own README duplicating its
  `package.json` `"description"` — keep the description accurate instead of
  letting the two drift apart.
- Prefer deleting dead code over commenting it out. If something's inert but
  too risky to fully untangle right now, say so in a comment with a reason,
  not just leave it silently sitting there (see `src/routes/settings.ts` in
  apps/api for a real example — noted, not hidden).
- Detector YAML files (`detectors/family/*.yaml`) are the source of truth
  for what LifeKeel currently understands about a family's finances — pure
  declarative rules, no code, interpreted by `@lifekeel/engine`. Adding a
  new family signal means: (1) extend the financial-profile schema in
  `apps/api/src/routes/family-financial-profile.ts`, (2) add/extend a
  detector YAML, (3) surface it in `apps/web`'s financial-profile form.

## Known gotchas (discovered the hard way this session — don't rediscover them)

- **Node 22+'s built-in `localStorage`** shadows jsdom's in Vitest and
  silently no-ops without `--localstorage-file`. `apps/web/vitest.setup.ts`
  works around it with an in-memory `Storage` polyfill — don't remove it.
- **`turbo.json`'s `test`/`typecheck` tasks depend on `["build", "^build"]`**,
  not just `["^build"]`. A package that self-imports its own name (e.g.
  `packages/platform`'s own test files importing `@lifekeel/platform`) needs
  its *own* `dist/` built first, not just its dependencies' — `^build` alone
  only builds dependencies. If you add a package with this pattern and it
  fails to resolve itself under `vitest`, this is why.
- **`pnpm test`/`pnpm typecheck` run standalone inside a single package**
  (e.g. `cd apps/api && pnpm test`) will show false "cannot find module
  '@lifekeel/x'" errors if that sibling package's `dist/` doesn't exist yet.
  Always verify via the root `pnpm typecheck`/`pnpm test` (turbo-orchestrated)
  before concluding something is actually broken.
- **Don't run `pnpm typecheck`/`pnpm build` while `next dev` is running.**
  Turbo's typecheck task runs `next build`, which overwrites
  `apps/web/.next` underneath the dev server — the served HTML then
  references chunks that don't exist (page renders unstyled, e.g. only the
  "Skip to content" link shows). Recovery: stop the dev server, delete
  `apps/web/.next`, restart `pnpm --filter @lifekeel/web dev`.
- `apps/api`'s integration tests that hit a real MongoDB/Redis (currently
  just `ml-tenant-isolation.test.ts`) will fail locally without one running —
  that's expected, not a regression. CI provisions both via service
  containers (`.github/workflows/ci.yml`). To run MongoDB/Redis locally and every other CI check (boot smoke test, integration
  tests, image builds), see [docs/local-testing.md](docs/local-testing.md).

## PRD → production, using Claude Code

This is the process for taking a product requirement from idea to shipped,
using Claude Code end-to-end. It's designed to let Claude do the bulk of the
PRD→plan→implement→test→review work with minimal hand-holding, while keeping
a human in the loop at the two points that actually matter: merging, and
deploying. That's a deliberate choice, not a limitation of what's possible —
see the note at the end if you want to go further.

1. **PRD intake.** Write (or paste) the requirement as a short brief: the
   problem, who it's for, what "done" looks like, and which trust tier it
   touches if it's agentic (see above). Doesn't need a template — a few
   sentences Claude can reason from is enough.
2. **Plan.** For anything non-trivial (new route, new detector, schema
   change, anything touching more than 2-3 files), use plan mode before
   writing code. Claude explores the codebase, proposes an approach, and
   gets your sign-off before implementing — this is what prevented several
   wrong turns during this repo's own build-out.
3. **Implement + test.** Claude writes the code and the tests together, not
   tests-as-an-afterthought. New backend logic needs a test that would fail
   without it. New detector logic needs to run correctly against
   `detector-evals/` if it's eligible for promotion.
4. **Self-review.** Run the `/code-review` skill (or equivalent) on the diff
   before opening a PR — catches correctness bugs and simplification
   opportunities Claude can fix in the same pass, before a human ever has to
   ask for the obvious changes.
5. **CI gate.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`,
   via `.github/workflows/ci.yml` — Mongo/Redis service containers included.
   This must pass before merge; it's the automated half of the safety net.
6. **Human review + merge.** A person reads the PR and merges it. This is
   the gate that exists on purpose — see below.
7. **Deploy.** `deploy-web.yml` / `deploy-api.yml` are `workflow_dispatch`
   (manual trigger), not auto-fire-on-merge. Promote to production is a
   deliberate, named action, not a side effect of a merge.

**Why steps 6–7 stay human-gated:** "ship the product autonomously" could
mean Claude doing the PRD→PR work end-to-end (what's described above), or it
could mean removing the human entirely — auto-merge, auto-deploy-to-prod on
green CI. This document implements the former. The latter is a real thing
you can build (GitHub Actions that invoke Claude Code non-interactively,
auto-merge on passing checks), but it's a deliberate, higher-risk choice for
a product whose whole premise is acting responsibly on a family's behalf —
it should be an explicit decision you make, not something that ships as a
side effect of asking for "best patterns." If you want it, ask for it by
name and we'll design the approval/rollback story around it specifically.
