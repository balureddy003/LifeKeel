# SDLC status: what is enforced today, what it costs, what is open

Everything in this file changes often; the [playbook](../ai-native-sdlc-playbook.md) is the stable
reference. Keep this one current: when you close or discover a gap, change a trigger, or
learn what GitHub can enforce, edit it here in the same PR.

Last reviewed: 2026-10-18.

Last expert review: the playbook was reviewed by four independent expert roles (an AI-native
SDLC architect, a security and compliance lead, a developer-experience reviewer, and a skeptical
staff engineer). Their findings were checked against the repo before use; the new gaps they
raised are G16 to G25 below.

## What GitHub can and cannot enforce here
Verified against the live repository: it is private, and the branch-protection
and ruleset APIs return 403 ("Upgrade to GitHub Pro or make this repository
public"). The `Production` environment exists but has **no protection rules**,
and required reviewers are likewise a paid feature for private repos. So today:

- Anyone with write access can push to `main`; "CI must pass" and "a person
  merges" are team conventions, not controls.
- The deploy approval pause is **not active**. `require-ci.yml` still checks the
  SHA, but `workflow_dispatch` runs the workflow file from the chosen branch, so
  a branch that edits that file can skip the check.
- Everywhere this document says "blocks" or "required", read it as "fails the
  check and the author is expected to stop". Sections 6.3 to 6.5 of the playbook describe
  the intended end state once the plan or visibility changes.

## Cost controls (Actions minutes and tokens)

**Measured baseline (`scripts/sdlc-metrics.sh 14`, 14 days to 2026-10-18, before the levers below
had taken effect):** `ci.yml` 51 runs and about 303 minutes of wall-clock, `security.yml` 44 runs and
about 142, `images.yml` 20 runs and about 95, and `claude-review.yml` 35 runs of which 22 failed for the
missing secret. That is roughly 540 minutes in two weeks, so about 1,150 a month against a 2,000
minute free allowance for private repositories (jobs bill separately, so the real figure is higher).
Re-run the script after a few weeks to see what the levers saved.

Measured from recent runs, a push to a ready PR cost roughly 6 minutes of CI plus
about 5 of security (CodeQL was about 4 of those), and the squash to `main` ran both
again (about 12 more). Levers now in place, and what each trades away:

| Lever | Saves | Trade-off |
|---|---|---|
| One `turbo run` graph, Next build cache | Wall time (tasks overlap, build compiles once) | None; turbo task results are deliberately **not** cached, so a failing test cannot replay as a pass |
| CodeQL weekly and on demand, not per PR or push | About 4 min per PR push, plus about 4 on merge | Findings surface up to a week late; results are only an artifact (code scanning is off) |
| No `security.yml` run on push to `main` | About 1 to 5 min per merge | Squashed commits are re-scanned at the next weekly run |
| Draft PRs skip CI and security | Everything while iterating | Mark ready (or push to a ready PR) to get checks |
| Claude review on open, ready or label; Sonnet, 8 turns | Tokens per push (most pushes now cost none) | Add the `claude-review` label to re-review |
| Dependabot grouped, majors ignored, actions monthly | One CI run per PR avoided, and fewer failing PRs | Majors are manual migrations |
| `timeout-minutes` on every job | Caps a hung job | A legitimately slow job needs its limit raised |
| Read-deny for `node_modules`, `dist`, `.next`, `.turbo`, lockfile | Tokens wasted on generated files | None |

Token habits for sessions are in `CLAUDE.md` ("Working economically"). Rough
estimates, not measurements: a ready-PR push drops from about 11 to about 7 Actions
minutes, a merge to `main` from about 12 to about 6, and a PR with several pushes
costs one Claude review instead of one per push. Re-measure with `gh run list`
after a week.

## Known gaps and owners

| ID | Gap | Why it matters | Suggested next step |
|---|---|---|---|
| G1 | Tier check is a tripwire, not proof | A caller can name an approver without a real decision | Add route-level tests that approve requires an authenticated human |
| G2 | `intent.md` not required by tooling | Process depends on discipline | Require the intent or PRD link in the PR template and check it in CI |
| G3 | No eval for document extraction or email summarisation | Advice or invented figures could enter via ingestion | Extend the eval harness to those prompts |
| G4 | Assistant eval threshold is a guess | May be too loose or too tight | Run against the live model once; set from the baseline |
| G5 | Advice scan covers detector and playbook YAML only | Hard-coded copy in web components and other prompts is unscanned | Extend to marketing copy and remaining system prompts |
| G6 | `claude-review.yml` ran on GitHub but cannot review until `ANTHROPIC_API_KEY` exists (it fails loudly) | Output quality is unknown | Add the secret, read the first reviews, then see G19 | 
| G7 | No post-deploy verification or rollback | A bad deploy is found by users | Smoke-test after deploy; document rollback |
| G8 | No production metrics loop | Maintain does not feed Plan | Define SLOs and alerts; link alerts to intents |
| G9 | No ADRs | Decisions are lost in PR threads | Add an ADR folder and a template |
| G10 | Branch protection and environment reviewers unavailable on this plan (verified, HTTP 403) | "Blocks merge" and the deploy approval are conventions | Upgrade the plan or make the repo public, then add required checks and reviewers |
| G11 | `POST /connectors/:id/actions/:action` ran any connector action (76 write actions across 32 connectors: broker orders, email, SMS, refunds, public posts) for an authenticated tenant with no approval gate | Rule 1 bypass | **Mitigated:** the route is read-only; only an exact registry GET action runs, everything else is 403 or 404 (`apps/api/src/connectors/action-gate.ts`), tested across every registry write action. Open: the workflow engine's `connector_action` nodes call the executor directly; an approved write flow, if wanted, must go through its own gate |
| G12 | Single maintainer: `CODEOWNERS` is one person | The human review gate is self-review | Add a second reviewer or document the accepted risk |
| G13 | Advice scan covers detector, family playbook, `verticals/family`, marketing landing, guides and blog copy only; 8 other LLM prompt files have no contract test or eval | Subtle drift in uncovered prompts | Add contract tests per prompt as they change |
| G14 | PRs bundle unrelated work (PR 35 spans rebrand, MFA and SDLC) | Weak review, painful merges | One concern per PR; enable auto-delete of merged branches |
| G15 | **Resolved.** The dead-code cleanup (PR 42) deleted `apps/api/src/eval/` (the Ask Keel prompt-contract test and adversarial eval, and `local-model-eval`, which `deploy-local-judge.yml` runs when `run_eval` is true) because nothing imports those entry points statically | Without it the assistant guardrails were unpinned and the local-judge eval step failed | Restored (PR 45); `eval:assistant` and `eval:local-model` scripts in `apps/api/package.json` now reference the entry points. Remaining: run the adversarial eval once against a live model and record the baseline (see G4) |

### Raised by the expert review

Each row was checked in the repo before it was added ("verified" says what was seen).
Agreement between reviewers is noted because it is the best predictor of importance.

| ID | Gap | Why it matters | Next step | Raised by |
|---|---|---|---|---|
| G16 | **Mitigated in `deploy-api.yml`** (PR for G16). The new revision is deployed with `--no-traffic`, smoke-tested at its own URL, then given traffic; production is re-checked and the previous revision is restored automatically on failure. The image is tagged with the verified SHA and `:latest` is gone; a `guard` job stops dispatch from any branch but `main`; a concurrency group stops two deploys racing. Remaining: the first-ever deploy has no previous revision to protect; tags are not immutable (use a digest if that matters); the guard does not stop a writer editing the workflow on their branch (G10); `deploy-web.yml` and `deploy-local-judge.yml` have the guard but no canary | A bad release can no longer reach users unnoticed | Dry-run it on a real unchanged commit and watch each step once; consider digests and Workload Identity Federation (G17) | architect, security, skeptic |
| G17 | **Production credentials are long-lived keys any branch workflow can read** (`GCP_SA_KEY`, Firebase key). The `Production` environment has no rules, so they are not scoped to it | A stolen token or a poisoned dependency reaches the cloud account with no audit trail | Workload Identity Federation limited to `refs/heads/main`; scope secrets to the environment where the plan allows; otherwise restrict at the GCP side | security |
| G18 | **Actions are pinned by tag** (`@v7`, `@v3`), including the ones next to deploy secrets. Verified | A retargeted tag runs attacker code with our secrets | Pin to full commit SHAs with a version comment; Dependabot keeps them current | security |
| G19 | **The Claude review is weaker than it looks.** It reads PR-controlled text (`CLAUDE.md`, diff, comments) with the API key in scope, and it skips `**/*.md` and `docs/**`, which includes `CLAUDE.md` and this playbook. Claude reviewing Claude-written code is correlated review. Verified in `claude-review.yml` | "No findings" is not evidence; the control surface itself is unreviewed | Always review `CLAUDE.md`, `.claude/**`, `scripts/hooks/**`, `.github/**` and the tripwire tests; restrict the action's tools; treat "no findings" as no signal. (`id-token: write` was added on purpose for the action; do not drop it without testing) | security, architect |
| G20 | **PR evidence is self-attested.** The template accepts ticked boxes with nothing pasted; nothing checks an intent or PRD link or a named tier (extends G2) | A solo maintainer routes around it within weeks | A small `github-script` PR check that fails without a tier line or a PRD/intent reference (skip docs-only PRs); add "paste the red mutation run" and "paste the eval number" fields | architect, skeptic |
| G21 | **The eval has no memory.** Results are printed, not stored; no model or prompt version is recorded; `model_error` counts as a blocked answer; the 25% threshold is a guess (extends G4) | Rule 2 drift is invisible, and an outage looks like drift | Append `{date, sha, model, prompt hash, block rate}` to a committed history file or artifact; fail on a regression of more than 5 points; report errors separately | skeptic, architect |
| G22 | **No change management for prompts and models.** No prompt version constant; the model is a deploy-time env var, so a model swap needs no PR or eval | A silent behaviour change on family data | A `PROMPT_VERSION` plus model id logged on every LLM call; a test that fails when a `SYSTEM_PROMPT` hash changes without a recorded eval | skeptic |
| G23 | **Docs drift.** Hand-measured numbers and lists go stale | Docs are the product of this practice | **Mitigated here:** `docs-links.test.ts` now also fails if a workflow is not named in the playbook or a gap id is cited but missing | architect, DX |
| G24 | **No measurements.** Nothing shows the practice works | Every control is unfalsifiable | **Started here:** `scripts/sdlc-metrics.sh` prints deploy frequency, change failure, lead time, gate bypasses and CI minutes from data the repo already has. Remaining: run it weekly and keep the trend | skeptic |
| G25 | **Agent permissions do not back the merge and deploy convention.** `.claude/settings.json` denies force-push only; `gh pr merge`, `git push origin main` and `gh workflow run` are allowed | The one control the owner owns locally is unused | An owner decision: deny them (it also stops delegated merges, which this repo currently uses). Not changed by an agent on a reviewer's suggestion | architect |

## One-time GitHub setup

These live in repository settings and cannot be set from the code.

1. **Environment `Production`:** it exists but has no rules. Required reviewers
   need a plan that supports them for private repos (above). Optionally
   restrict deployment branches to `main`.
2. **Secret `ANTHROPIC_API_KEY`:** needed by `claude-review.yml`.
3. **Branch protection on `main`** (unavailable on the current plan): require pull requests, require the
   `build`, `codeql`, `dependency-audit`, `secret-scan` and `python-services`
   checks, disallow force pushes.
4. **Code scanning:** CodeQL results appear under Security once the workflow
   has run; the job needs `actions: read` (already set).
