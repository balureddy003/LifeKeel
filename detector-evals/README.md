# Detector Evaluation Cases

Add `<detector-id>.yaml` golden datasets here. Detector promotion runs these
cases through `DetectorEvalRunner`; F1 below 0.80 or a regression greater than
5% blocks promotion unless an administrator records an audited override note.

Note: the promotion route this powers (`detector-promotions.ts`) isn't
registered in this trimmed backend — see `ARCHITECTURE.md`. The family
detectors (`detectors/family/*.yaml`) have no eval cases here yet.
