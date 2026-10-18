# Extending the SDLC

How to add a check, hook, skill, eval, workflow, or gate without breaking the ones that
exist. Each recipe says what to create, where it plugs in, and how to prove it works.
Read the [playbook](../ai-native-sdlc-playbook.md) first for what already exists.

## Choose the right mechanism

| You want | Use | Why |
|---|---|---|
| A rule that must hold for people and CI too | A **test** | Runs in `pnpm test`, no setup |
| Claude to be told immediately, right after an edit | A **hook** | Runs without anyone remembering, but only inside Claude Code |
| A multi-step recipe loaded only when relevant | A **skill** | Costs no tokens until used |
| An always-true rule every session needs | A line in **CLAUDE.md** | Loaded every session, so keep it short |
| Something to run on every PR in GitHub | A **workflow** | Costs Actions minutes, so see the checklist in recipe 6 |

If forgetting it causes harm, it is a test or a hook, not a note.

## Definition of done for any SDLC change

- [ ] It **fails when the rule is broken**. Break the rule on purpose, see red, restore, see green (recipe 0).
- [ ] The relevant docs changed in the same PR: playbook matrix (section 8), workflow table (6.3), gaps (10).
- [ ] Cost considered: minutes added per PR push, tokens added per session.
- [ ] No permission granted to the assistant without the owner's say-so (see recipe 3).

## 0. Prove a check can fail (do this for every recipe)

A check that has never failed is unverified. Pattern used for the trust-tier test:

```bash
cp apps/api/src/routes/insights.ts /tmp/insights.bak        # 1. back up
# 2. break the rule: delete `approvedBy: ...` from an execute() call
cd apps/api && npx vitest run src/__tests__/trust-tier-gate.test.ts   # 3. expect red
cp /tmp/insights.bak src/routes/insights.ts                  # 4. restore
git diff --stat                                              # 5. empty = restored
```

Also give the test a **self-check**: assert that the matcher flags a deliberately bad
string, so a regex that matches nothing cannot pass silently.

## 1. Cover a new place the advice rule must hold

The advice test scans a fixed list of files. If new user-facing copy lives elsewhere
(a new vertical, a new page), add it.

1. Open `packages/engine/src/__tests__/advice-rule.test.ts`.
2. YAML copy: add the path or directory to `copyFiles()`. Web copy in `.ts` or `.tsx`:
   add it to `webCopyFiles()` (it skips the buy/purchase pattern, which is ordinary UI wording).
3. Run `cd packages/engine && npx vitest run src/__tests__/advice-rule.test.ts`.
4. If it fails, the failure message is `file:line [pattern] text`. Fix the copy; do not
   weaken the pattern. Banned: "you should", "we recommend", buy/switch instructions,
   "best <product>", and named providers.
5. To extend the **edit-time hook** to the new location, add its glob to the `case`
   in `scripts/hooks/advice-check.sh` (recipe 3 covers testing it).

## 2. Cover a new way to act on a family's or tenant's behalf

`apps/api/src/__tests__/trust-tier-gate.test.ts` allow-lists every file that can reach an
outward-facing door (`ActionExecutor`, the social publisher, `ConnectorActionExecutor`).

When you add a caller, **add it to the list with a reason that names its tier**:

```ts
const ALLOWED_CALLERS: Record<string, string> = {
  'routes/insights.ts': 'Tier 2: POST /insights/:id/approve, human user_id',
  'routes/my-new-route.ts': 'Tier 2: <what it does, what approval gates it>',
}
```

Then make the code satisfy the test: the `execute()` call must name `approvedBy`, and
the action must pass through the approval gate, not around it. The test is a tripwire.
It cannot prove a human really decided, so the PR description must say how.

For connector actions: `POST /connectors/:id/actions/:action` is **read-only by design**
(`apps/api/src/connectors/action-gate.ts`). Only an exact registry `GET` action runs.
Do not loosen it to add a write. Build a separate route with its own approval record and
caps, and add that route to the allow-list above.

## 3. Add or change a hook

Hooks live in `.claude/settings.json` and call a script in `scripts/hooks/`.

```json
"hooks": { "PostToolUse": [ { "matcher": "Edit|Write",
  "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/scripts/hooks/my-check.sh" } ] } ] }
```

The script receives the tool call as JSON on stdin. Exit `0` to pass; exit `2` to feed
stderr back to Claude so it can fix the problem in the same turn. Keep it fast and quiet
when it passes. Test it without Claude by piping a payload:

```bash
echo '{"tool_input":{"file_path":"'$PWD'/detectors/family/zz-tmp.yaml"}}' \
  | CLAUDE_PROJECT_DIR=$PWD scripts/hooks/advice-check.sh; echo "exit=$?"
```

Know the limits: it only runs inside Claude Code (CI is the real backstop), it matches
only the tools you list, and `advice-check.sh` exits `0` if it cannot find the package,
so it fails open.

**Permissions are not yours to add.** `permissions.deny` entries that restrict access
are fine to propose. Do not add `permissions.allow` entries that widen what the assistant
can run; that is the repository owner's decision. The permission check will block it, and
the PR description should list the suggested rules for the owner instead.

## 4. Add a skill

A skill is a folder with a `SKILL.md`:

```text
.claude/skills/<name>/SKILL.md
---
name: <name>
description: One sentence saying what it does and when to use it.   # this is what triggers it
---
Numbered steps. Name the real files. End with how to verify.
```

Write the `description` for the moment someone asks, not for the implementation. Keep the
body to the recipe: if it grows past a screen, move reference material to the playbook and
link it. The existing example is `.claude/skills/add-detector/SKILL.md`.

## 5. Guard an LLM prompt

For any system prompt that touches family data:

1. **Contract test (free, runs in CI).** Import the prompt and assert each guardrail
   clause with a regex, so rewording is fine and deleting a guardrail is not:
   ```ts
   import { SYSTEM_PROMPT } from '../routes/assistant.js'
   expect(SYSTEM_PROMPT).toMatch(/never recommend, compare, or steer toward a specific product or provider/i)
   ```
2. **Output guard (runtime).** Wrap the model call in `withOutputGuard` (`apps/api/src/local-model.ts`)
   so advice, provider steering and invented figures are blocked at runtime.
3. **Adversarial eval (opt-in, costs tokens).** A fixed context plus questions that try to
   cross a rule ("which policy should I buy?"), calling the model without the guard and
   measuring how often the guard would have had to step in. Run it before changing the
   prompt or the model.

> **History:** the dead-code cleanup (PR 42) removed `apps/api/src/eval/` because nothing imports those entry points statically; PR 45 restored it from `1ae5ddb^` and added `eval:assistant` / `eval:local-model` scripts so they read as used. If you add an eval entry point, give it a `package.json` script for the same reason. See playbook gap G15.

## 6. Add or change a GitHub workflow

Checklist, because every workflow costs minutes on every PR:

- [ ] **Trigger is as narrow as it can be.** Prefer `pull_request` over also `push`; add
      `paths`/`paths-ignore` for heavy jobs; use a schedule for slow, rarely-changing scans.
- [ ] **Skips drafts** where checks are not needed: `if: ... || !github.event.pull_request.draft`,
      with `ready_for_review` in `types`.
- [ ] **`concurrency` with `cancel-in-progress`** for PR workflows (never for deploys).
- [ ] **`timeout-minutes`** on every job.
- [ ] **Least privilege**: set `permissions:` explicitly; no `contents: write` unless needed.
- [ ] **Pinned action versions** (`@v7`, not `@main`).
- [ ] **Fails loudly** when a required secret is missing. An empty key must not read as a pass.
- [ ] Added to the playbook table (6.3) with whether it blocks merge, and the cost table (6.6).
- [ ] Measure after a week: `gh run list --workflow <file> -L 20 --json createdAt,updatedAt,conclusion`.

## 7. Change a rule itself

A rule change touches four places, in one PR: the wording in `CLAUDE.md`, the test or
hook that enforces it, the matrix in playbook section 8, and (if user-visible) the PR
template. Stop and ask a person if the checks and your judgement disagree; never loosen
a rule or its test to make a change pass.
