# LifeKeel — instructions for Claude Code (and any AI agent working here)

LifeKeel is the autonomous digital twin for your family. Full product vision,
current architecture, and phased roadmap: [ARCHITECTURE.md](ARCHITECTURE.md).
Read that before making any change that touches product direction, not just
this file. For the mechanical commands/gotchas an AI agent needs day-to-day,
see `.devin/AGENTS.md`.

## Repo map

```
apps/web      Next.js frontend (static-exported to Firebase Hosting).
              User-facing product. package name: @lifekeel/web
apps/api      Fastify backend. package name: @lifekeel/api
packages/*    Shared libraries apps/api depends on (see each package's
              own README.md and package.json "description" for its role).
detectors/, connectors/, definitions/, verticals/, detector-evals/,
category-table.yaml
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

## The third rule: family content is not model training data

LifeKeel must not use personal or family content to train or fine-tune a shared
or third-party foundation model. Hosted AI calls are processing, not training,
and must use task-minimized context, tenant authorization, approved processor
terms, explicit retention/deletion rules, and metadata-first telemetry.

Do not route family content through consumer/free AI endpoints, personal API
keys, provider-side memory/file/vector stores, or unapproved batch/fine-tuning
APIs. Local and on-device paths are preferred for high-sensitivity tasks. Any
future cross-tenant learning (including the dormant federated-learning code)
requires explicit opt-in, privacy review, minimum-cohort/privacy-accounting
controls, deletion/retraining evidence, and user-facing disclosure. Any stale
`federated_global_models` artifact must be deleted/quarantined or gated before
scorer warm-start can use it.

## How the rules are enforced (not just stated)

- **Advice rule (second rule):** `packages/engine/src/__tests__/advice-rule.test.ts`
  fails CI if detector/playbook copy contains recommendation verbs or named
  providers. `.claude/settings.json` runs it as a PostToolUse hook
  (`scripts/hooks/advice-check.sh`) so Claude sees the failure immediately
  after editing that copy.
- **PRs:** `.github/pull_request_template.md` makes tier and advice check
  explicit. New work starts from `docs/templates/intent.md`.
- **Skill:** `.claude/skills/add-detector` encodes the add-a-detector recipe.
- **Trust tiers (rule 1):** `apps/api/src/__tests__/trust-tier-gate.test.ts`
  allow-lists the only callers of `ActionExecutor` and requires each
  `execute()` to name `approvedBy`. Adding a caller means editing that list,
  which forces the tier question into review. It is a tripwire, not proof.
- **AI data use (rule 3):** the AI task gateway (`apps/api/src/ai/task-gateway.ts`,
  policies in `definitions/ai-tasks.yaml`) is the only door to a model call.
  `apps/api/src/__tests__/ai-task-gateway.test.ts` fails CI if a source file
  constructs a raw model client outside the allow-listed factories, if a
  `taskLlm/taskDecide/taskVision` call names an unregistered task, or if a raw
  `localDecisionFromEnv` escapes its `taskDecide` wrapper. Unknown task_ids
  fail closed outside dev. The processor registry
  (`definitions/ai-processors.yaml`, per-task `allowed_processors`) is checked
  before every call, but in `AI_PROCESSOR_ENFORCEMENT=warn` (the default) a
  violation is logged and counted, not blocked: every hosted processor ships
  `unreviewed` because no terms have been supplied, so `enforce` would refuse
  every hosted call today. A `lifekeel_infra` task still falls back to a hosted
  provider when `LOCAL_TEXT_ENABLED` is off; the check flags it, it does not
  stop it. Provider no-training and retention terms, Gmail Limited Use
  exclusion from cross-tenant scorers, and a consent flow for third-party AI
  remain procedural. Do not claim rule 3 is technically enforced by code
  alone; see ARCHITECTURE.md §8.15 for the full list.

Detail on what each check catches (and cannot):
[docs/ai-native-sdlc-playbook.md](docs/ai-native-sdlc-playbook.md#8-rules-to-enforcement).

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
- **Model-serving split is decided (2026-10):** general interactive
  generation (Ask Keel, drafts) runs on a small hosted processor behind the
  gateway — never the CPU-local model. CPU-local serving of interactive
  generation was measured (50s p50 vs a 30s deadline) and is closed. Local
  serving remains for quarantined tasks (`lifekeel_infra_required`) and
  batch work. See ARCHITECTURE.md §8.4b and
  `docs/reviews/decision-local-interactive-closed-2026-10.md` — do not
  re-propose `LOCAL_TEXT_ENABLED` for general interactive traffic.

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

## PRD → production (full detail: the playbook above)

1. **Intent/PRD** — problem, who, "done", and the trust tier if agentic.
2. **Plan mode** for anything non-trivial (new route/detector, schema change,
   more than 2-3 files); get sign-off before code.
3. **Implement + test together**; new backend logic needs a test that fails
   without it; detector changes run against `detector-evals/`.
4. **Self-review** with `/code-review` before opening the PR.
5. **CI gate** (`ci.yml`: typecheck, lint, test, build) must pass.
6. **Human review + merge**, then 7. **manual deploy** (`workflow_dispatch`,
   `require-ci.yml` checks the SHA). These two stay human-gated on purpose:
   auto-merge or auto-deploy on green CI is a deliberate, higher-risk choice
   for a product that acts on a family's behalf. Ask for it by name and we
   design the approval/rollback story first; it is not a side effect of
   "best patterns".

## Working economically (tokens and CI minutes)

- Read only what you need: use line ranges for big files, `Explore` for broad
  searches, and never read `pnpm-lock.yaml`, `dist/`, `.next/` or `node_modules`.
- Run `pnpm turbo run typecheck lint test build` once at the end, not after
  each edit; target one package's tests while iterating.
- Keep PRs to one concern and push when ready: every push to a ready PR runs
  CI. Use draft PRs while iterating (CI skips drafts).
- PR review is a person using their own coding agent (`/review-pr <N>`); there
  is no AI review in CI. CodeQL runs weekly, not per PR.
