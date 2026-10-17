## What and why
<!-- Link the PRD (docs/prd/NNN-*.md) or intent this implements. -->

## Trust tier (CLAUDE.md rule 1)
- [ ] Touches no autonomous action, **or** it is Tier ___ and has an explicit human approval gate

## Regulated-advice check (CLAUDE.md rule 2)
- [ ] New/changed user-facing copy describes what is on file; no "buy X", no named provider, no switch flow
- [ ] `advice-rule.test.ts` passes

## Verification
- [ ] Test added that fails without this change
- [ ] New/changed detector has a `detector-evals/` dataset
- [ ] `/code-review` run on the diff; findings addressed
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green
