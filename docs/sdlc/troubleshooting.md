# Troubleshooting the SDLC

Symptom first, then cause, then the fix. Everything here happened to someone on this
repo. If you hit something new, add a row.

## A check is red or missing

| Symptom | Cause | Fix |
|---|---|---|
| `review` (Claude PR review) is red with "ANTHROPIC_API_KEY is not set" | The repo secret does not exist. The job fails on purpose; before that guard it passed having reviewed nothing. | Add the secret under Settings, Secrets and variables, Actions. Then add the `claude-review` label to the PR to re-run. |
| No checks ran on my PR | It is a **draft**. CI and security skip drafts. | Mark it ready for review. |
| No Claude review appeared | It runs once when the PR opens or is marked ready, not on every push; docs-only PRs and Dependabot are skipped. | Add the `claude-review` label. |
| CodeQL did not run on my PR | By design it runs weekly and on demand (`Actions`, `Security`, `Run workflow`), and only produces an artifact. | Trigger it manually if you need it now. |
| `dependency-audit` fails with a high advisory | A transitive dependency has a known vulnerability. | Add a patched version to `pnpm.overrides` in the root `package.json`, run `pnpm install`, re-run `pnpm audit --prod --audit-level=high`. If no patched release exists, write down the exception in the PR. |
| `build` fails only in CI | Cached or stale local state hid it, or a sibling package's `dist/` was missing locally. | Run `pnpm turbo run typecheck lint test build --force` from the repo root. |
| `ml-tenant-isolation` fails locally; `email-scan-fanout.integration` is skipped | They need a real MongoDB and Redis. The first has no skip guard so it fails; the second skips when the services are absent. Expected, not a regression. | See [local-testing.md](../local-testing.md); CI provides both. |
| "cannot find module `@lifekeel/x`" running a test inside one package | That sibling package has no `dist/` yet. | Run from the repo root: `pnpm test` or `pnpm turbo run test`. |
| Page renders unstyled during local dev | `pnpm typecheck` or `build` ran while `next dev` was up and overwrote `.next`. | Stop dev, delete `apps/web/.next`, restart `pnpm --filter @lifekeel/web dev`. |

## A guardrail blocked me

| Symptom | Cause | Fix |
|---|---|---|
| Claude reports "Advice-rule check failed" after editing a detector | The copy contains a recommendation phrase, a buy/switch instruction, a "best <product>" claim, or a named provider. | Reword to describe what is on file and point to "a licensed professional" or "compare quotes from multiple insurers". Do not weaken the pattern. |
| `advice-rule.test.ts` fails on web copy | Same rule, applied to the landing page, guides and blog. | Same fix. Failure text is `file:line [pattern] text`. |
| `trust-tier-gate.test.ts` fails: "only allow-listed files import ActionExecutor" (or `ConnectorActionExecutor`, or `createPost`) | You added a new caller of an outward-facing door. | Intended friction. Add it to the allow-list **with a reason naming its tier**, and make sure it passes through an approval gate. See [extending, recipe 2](extending.md#2-cover-a-new-way-to-act-on-a-familys-or-tenants-behalf). |
| `trust-tier-gate.test.ts` fails: "execute() without approvedBy" | A call omits who approved it. | Pass `approvedBy` with the real user id (or the explicit `auto-trust` opt-in). |
| A connector write action returns `403 action_requires_approval` | `POST /connectors/:id/actions/:action` is read-only on purpose. | Do not loosen it. Build a route with its own approval step and add it to the trust-tier allow-list. |
| `404 unknown_action` for a connector action | The id is not exactly a registry action (the executor aliases some ids, so aliases are refused). | Use the exact id from `packages/workflows/src/connectors/ConnectorRegistry.ts`. |
| "Permission denied by the classifier" for a command | The assistant tried something that modifies shared resources or its own permissions. | Not a bug. Run it yourself, or add a narrow permission rule if you accept it. Do not ask the assistant to work around it. |

## Git and merges

### Stacked PRs conflict after a squash merge

Squash-merging the bottom PR gives `main` one new commit with the same *content* as the
branch but different history, so the PRs stacked on it conflict.

1. Merge from the **top down into the base**, with merge commits, so the stack collapses
   into the bottom PR: merge PR N into PR N-1's branch, and so on.
2. Then bring `main` into the bottom branch. If `main`'s tree equals the old branch tip
   (check with `git diff --stat origin/main <old-tip>`, empty means equal), keep your tree
   and record the merge: `git merge -s ours origin/main`, then re-apply any later `main`
   commits with `git diff <squash-sha> origin/main | git apply --3way --index`.
3. Confirm the net diff against `main` is only your intended files, then squash-merge.

If the feature branch forked **before** a repo-wide rename (the rebrand did this), run the
same rename over the files you changed first, then merge: far fewer conflicts remain.
Take `main`'s side only for lines `main` revised later (`git merge -X theirs origin/main`),
and re-run the full checks afterwards.

### My local `main` diverged after a squash merge

`git status` says "have diverged". Do **not** `git pull`: it merges old history into new
and produces dozens of false conflicts.

```bash
git merge --abort 2>/dev/null          # if a pull left a merge in progress
git fetch origin
git log --oneline origin/main..main    # commits only your main has
```

If every commit listed is also on a branch or PR you still have, nothing is lost:
`git reset --hard origin/main`. If any commit is unique, branch it first
(`git branch rescue/<name>`).

### I need to edit a branch without disturbing my checkout

Use a worktree: `git worktree add ../wt-name -b my-branch origin/main`, work there, push,
then `git worktree remove ../wt-name`. A fresh worktree has no `node_modules`; run
`pnpm install --offline` (or symlink) before running tests, and never commit those links.

## Deploys

| Symptom | Cause | Fix |
|---|---|---|
| `verify-ci` fails: "not in main's history" | You asked for a ref that is not on `main`. | Merge through a PR first. Hotfixes go through `main` too. |
| `verify-ci` fails: "No successful CI run" | CI has not finished (or failed) on that exact commit. | Wait for `ci.yml` on `main`, or fix it. A squash creates a new commit that needs its own run. |
| The deploy did not pause for approval | By design today: the `Production` environment has no required reviewers, and this plan cannot add them (see [status](status.md#what-github-can-and-cannot-enforce-here)). | You are the gate. Read the smoke test result; know the rollback command (gap G16) before you dispatch. |
| Local-judge deploy fails at the model eval step with module-not-found | You deployed a commit from before the eval harness was restored. | Deploy a commit on current `main`, or set `run_eval` to false. |

## Hooks and Claude Code

| Symptom | Cause | Fix |
|---|---|---|
| The advice hook never fires | It matches `Edit` and `Write` on `detectors/family` and `playbooks/family` only, and runs inside Claude Code only. | Run `cd packages/engine && npx vitest run src/__tests__/advice-rule.test.ts`; CI runs it regardless. |
| The hook fails with a missing-package error | `node_modules` is not installed in this checkout or worktree. | `pnpm install`. The hook exits `0` when it cannot find the package, so it fails open; CI is the backstop. |
| Claude keeps reading huge generated files | They are not denied. | Check `.claude/settings.json` `permissions.deny` for `node_modules`, `dist`, `.next`, `.turbo`, the lockfile. |
