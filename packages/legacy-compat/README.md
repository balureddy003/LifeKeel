# @lifekeel/legacy-compat

Pure compatibility adapters translating legacy outcome-model shapes into the
open `@lifekeel/specifications` contracts. `apps/api/src/outcomes/` uses
this for its `LegacyGoalOutcomeBridge` — data-migration-shaped code kept
alive because `routes/settings.ts` still depends on it transitively, not
because goals are an active LifeKeel feature (they aren't — see the root
`SECURITY.md`).
