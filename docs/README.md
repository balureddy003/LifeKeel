# Documentation index

Start with the row that matches what you are doing.

## Process (how we build and ship)

| Doc | Read it when |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | You are making your first change. One page, the whole loop. |
| [CLAUDE.md](../CLAUDE.md) | You work with Claude Code or any AI agent here. The two rules, conventions, gotchas. |
| [AI-native SDLC playbook](ai-native-sdlc-playbook.md) | You want the why, every check, the cost levers, and the known gaps. The reference. |
| [Extending the SDLC](sdlc/extending.md) | You want to add a tripwire test, hook, skill, eval, workflow, or gate. Recipes with templates. |
| [Troubleshooting](sdlc/troubleshooting.md) | A check is red, a hook blocked you, a merge went wrong. Symptom to fix. |
| [Running checks locally](local-testing.md) | You need Mongo/Redis, the boot smoke test, image builds, or local models. |
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

## Keeping these docs true

The process docs are checked by a test, `packages/engine/src/__tests__/docs-links.test.ts`:
every relative link and every repo path named in backticks must exist. It runs in `pnpm test`,
so moving or deleting a file that a doc names fails CI until the doc is updated.

When you change a gate, update the doc in the same PR:

- A new or changed rule or tripwire: the matrix in playbook section 8 and the relevant
  `CLAUDE.md` line.
- A new workflow or trigger change: the table in playbook section 6.3 and the cost table in 6.6.
- A new gap you found and did not fix: a row in playbook section 10.
- A new symptom someone will hit: a row in [troubleshooting](sdlc/troubleshooting.md).
