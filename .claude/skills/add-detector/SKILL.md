---
name: add-detector
description: Add a new family financial signal end-to-end (profile schema, detector YAML, golden eval dataset, web form). Use when asked to add or extend a detector.
---

Follow CLAUDE.md "Conventions" order exactly:

1. Extend the profile schema in `apps/api/src/routes/family-financial-profile.ts`.
2. Add/extend `detectors/family/<name>.yaml`. Copy must follow the advice rule: describe what is on file, point to "a licensed professional" / "compare quotes from multiple insurers". Never "buy X", never a named provider.
3. Add `detector-evals/family_<name>.yaml` with positive and negative cases (a detector is not promotable without one) and add its id to `FAMILY_DETECTORS` in `packages/engine/src/__tests__/family-detector-evals.test.ts`.
4. Surface the field in the `apps/web` financial-profile form.
5. Verify from the repo root: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (never inside one package; see the gotchas in CLAUDE.md).
