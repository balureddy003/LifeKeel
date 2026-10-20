# Documentation index

Start with the row that matches what you are doing.

## Process (how we build and ship)

| Doc | Read it when |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | You are making your first change. One page, the whole loop. |
| [CLAUDE.md](../CLAUDE.md) | You work with Claude Code or any AI agent here. The two rules, conventions, gotchas. |
| [AI-native SDLC playbook](ai-native-sdlc-playbook.md) | You want the why, every check, the cost levers, and the known gaps. The reference. |
| [Extending the SDLC](sdlc/extending.md) | You want to add a tripwire test, hook, skill, eval, workflow, or gate. Recipes with templates. |
| [SDLC status](sdlc/status.md) | You want what is enforced today, what CI costs, what GitHub can and cannot enforce, and the open gaps (G1 to G25). Changes often. |
| [Reviewing a PR](sdlc/reviewing.md) | You are reviewing someone's PR (a person, with your own coding agent). There is no AI review in CI. |
| [Troubleshooting](sdlc/troubleshooting.md) | A check is red, a hook blocked you, a merge went wrong. Symptom to fix. |
| [Running checks locally](local-testing.md) | You need Mongo/Redis, the boot smoke test, image builds, or local models. |
| [Mobile store releases](mobile-release.md) | You are shipping the Capacitor shell to TestFlight/Play — one-time setup, secrets, trigger. |
| [.devin/AGENTS.md](../.devin/AGENTS.md) | You run a non-Claude agent. Mechanical facts and commands. |

## Product (what we build and why)

| Doc | Read it when |
|---|---|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Anything touches product direction, or you need the trust tiers (0 to 3). |
| [prd/](prd/README.md) | You are starting or reading a requirement. 000 and 007 are the shared references. |
| [reviews/](reviews/README.md) | You want point-in-time audits. Findings that need work graduate into a PRD. |
| [SECURITY.md](../SECURITY.md) | You wonder what was removed from the original monorepo and what gaps remain on purpose. |

## Templates and prompts

| File | Use |
|---|---|
| [templates/intent.md](templates/intent.md) | The start of any change. |
| [.github/pull_request_template.md](../.github/pull_request_template.md) | Filled in on every PR. |
| [prompts/](prompts/gtm-public-content-review.md) | Reusable briefs, for example the go-to-market review. |

## Glossary

| Term | Meaning |
|---|---|
| Trust tier | How much an action may do on its own. 0 observe and explain; 1 prepare a draft a human sends; 2 act after narrow per-action consent; 3 autonomous, opt-in, reversible and low stakes only. Defined in [ARCHITECTURE.md](../ARCHITECTURE.md#9-act-and-escalate-trust-tiers). |
| Approval gate | A step where a named human must say yes before an outward action runs (for example `POST /insights/:id/approve`). |
| Tripwire | An automated test or hook that catches the obvious breach of a rule. It is not proof that a human decided. |
| Mutation check | Break the rule on purpose, watch the check fail, then restore. Proves a check can fail. |
| Golden dataset | Hand-written input and expected-output cases in `detector-evals/` that a detector must get exactly right. |
| `approvedBy` | The field recording which person (or explicit `auto-trust` opt-in) authorised an action. |
| Intent | The short problem, "done", tier and advice check that starts a change (`docs/templates/intent.md`). |
| Turbo | The task runner behind `pnpm typecheck/lint/test/build`; always run it from the repo root. |

## Where gaps live

Three registers track open problems, each with a different scope. File a
new gap in the one whose scope it fits:

| Register | Scope | Granularity |
|---|---|---|
| [ARCHITECTURE.md §16](../ARCHITECTURE.md#16-prioritized-architecture-gap-register) | Architecture and quality-attribute gaps (P0–P2) with mitigations and exit criteria | System-level |
| [sdlc/status.md](sdlc/status.md#known-gaps-and-owners) | Process/tooling gaps in the SDLC itself (G1+) | Practice-level |
| [intents/](intents/README.md) | Accepted remediation work not yet a PRD | Work items |

Point-in-time findings live in [reviews/](reviews/README.md); anything that
needs engineering graduates into an intent or a PRD rather than staying a
review finding.

## Keeping these docs true

The process docs are checked by a test, `packages/engine/src/__tests__/docs-links.test.ts`:
every relative link and every repo path named in backticks must exist. It runs in `pnpm test`,
so moving or deleting a file that a doc names fails CI until the doc is updated.

When you change a gate, update the doc in the same PR:

- A new or changed rule or tripwire: the matrix in playbook section 8 and the relevant
  `CLAUDE.md` line.
- A new workflow or trigger change: the table in playbook section 6.3 and the cost levers in [status.md](sdlc/status.md#cost-controls-actions-minutes-and-tokens). The test fails if a workflow file is not described.
- A new gap you found and did not fix: a row in [status.md](sdlc/status.md#known-gaps-and-owners). The test fails if a gap id is cited but not defined.
- A new symptom someone will hit: a row in [troubleshooting](sdlc/troubleshooting.md).
