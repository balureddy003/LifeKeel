# Detector Evaluation Cases

`<detector-id>.yaml` golden datasets live here. `POST /detectors/:id/eval`
(`apps/api/src/routes/detector-evals.ts`) runs these cases through
`DetectorEvalRunner`; F1 below 0.80 or a regression greater than 5% vs the
stored 'promotion' baseline reports `promotable: false` with the blocking
reasons. The route is a verdict surface only — promotion itself stays a
deliberate YAML change + human merge, never an API side effect.

The same datasets run as a test in
`packages/engine/src/__tests__/family-detector-evals.test.ts`, so a detector
regression fails CI before the gate is ever invoked.

Coverage: all four family detectors (`detectors/family/*.yaml`) have golden
datasets here. New detectors must add one before they're promotable.
