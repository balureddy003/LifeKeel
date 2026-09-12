# @agentoak/engine

The deterministic rules engine — Agent Oak's Family Intelligence layer
today. Loads YAML detector definitions (`detectors/family/*.yaml` for this
product; the repo also still carries other verticals' YAML, inert without
their routes — see root `SECURITY.md`), evaluates them against submitted
signals (e.g. a family's financial profile), and produces scored insights
with a reasoning trace and evidence chain. Also hosts optional ML-quality
scaffolding (`ScoreCalibrator`, `NoveltyTracker`, `ChangePointDetector`,
`FeatureHashScorer`, `TenantLevelScorer`) that `apps/api/src/server.ts`
wires into `engine.options` — cross-vertical calibration infra, not
family-specific.

See `ARCHITECTURE.md` for how this fits into the four-layer Agent Oak
vision (this package is squarely "Family Intelligence").
