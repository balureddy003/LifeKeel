# Intent 22: Freshness of derived surfaces after profile/policy changes

**Problem** — QA observed stale figures: after a profile or policy update,
insight cards and "AI Explains" narrative could still show the older cover
amount, and scenario explanatory text did not refresh on navigation. The
readiness score itself already recomputes on every read and shows
"Recalculated …" (`apps/web/src/app/page.tsx` score card); the surfaces
around it don't carry the same guarantee, so a correct score next to a stale
explanation reads as a bug.

**Done looks like**
- Every derived surface (insight detail, AI-generated explanation, scenario
  text) is keyed to or invalidated by the inputs it was computed from —
  either recomputed on read like the score, or carries a visible
  recalculated-at provenance so staleness is honest rather than silent.
- Navigating to a surface after saving profile/policy changes shows the new
  figures without a manual refresh.
- A regression test mutates a policy/profile field and asserts the rendered
  figure changes on next read.

**Constraints**
- Trust tier: 0 — reads and rewrites of derived display data only.
- Any narrative that goes through a model uses the AI task gateway
  (`ai/task-gateway.ts` + `definitions/ai-tasks.yaml`) — no new raw model
  calls; cache keys include the input fingerprint.
- Regulated-advice check: unchanged — explanations describe on-file state.

**Out of scope** — realtime push/instant cross-device sync (PRD-140
territory); new explanation content; score computation (already live).

**Becomes** — PRD in docs/prd/, likely alongside or amending PRD-107's
insight-lifecycle work.

---

**Status: implemented — PR #248.** Root cause: `persistAndDeliverInsights`
skipped a re-fire against an already-open insight, so `reasoning` figures
froze at first-fire values. Open cards now refresh figure-bearing fields
on each evaluation (`refreshed_at` stamped) while lifecycle state is
preserved. Remaining open item: the *score and scenario math* already
recompute per read; AI-narrated explanation text freshness follows the
same refreshed figure once this lands.
