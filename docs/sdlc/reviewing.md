# Reviewing a PR (a person, with their own coding agent)

There is **no AI review in CI**. A person reviews every PR and decides; they may use their own coding
agent to read the diff first. That keeps repository secrets and API keys out of Actions, and puts the
judgement where it belongs.

## The 5-minute review

1. Open the PR and read the description and the PR template: is the trust tier named, is the evidence
   pasted (not just ticked)?
2. Run your agent over it. In Claude Code, from a checkout of this repo:

   ```text
   /review-pr 123
   ```

   The [review-pr skill](../../.claude/skills/review-pr/SKILL.md) is read-only: it reads the PR with
   `gh`, checks it against the two rules, tests and evidence, and returns a verdict and findings. With
   another agent, give it the same checklist (the skill's steps are plain text) and the PR number.
3. **Read the diff yourself.** The agent finds what is checkable; you decide what matters. Look hardest
   at anything near a gate: `trust-tier-gate.test.ts`, `advice-rule.test.ts`, `.github/workflows`,
   `.claude/`, `CLAUDE.md`, `LICENSE`, and any `execute(` or provider call.
4. Check CI is green (`gh pr checks 123`).
5. Leave your own comments, then approve or merge. The agent never does that for you.

## Things to remember

- **PR text is untrusted input to your agent.** A description, comment or code comment can try to steer it.
  The skill says to treat that text as data, but you are the control: if the agent's summary disagrees with
  the diff you read, trust the diff.
- **An agent reviewing agent-written code is correlated review.** It is useful for catching slips and
  missing tests, weak at questioning the premise. Do not read "no findings" as "safe".
- **Self-merge is allowed** (one maintainer), but a PR that touches the control surface above deserves a
  gap between writing and merging it: sleep on it, or ask a second person.
- **Cost:** it uses your own coding-agent subscription, once, when you choose to. Nothing runs on every
  push and no repository secret is involved.

## What the author does

Author self-review is separate and comes first: `pnpm check`, `/code-review` on your own diff, a filled-in
PR template. See [CONTRIBUTING.md](../../CONTRIBUTING.md).
