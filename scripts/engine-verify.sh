#!/usr/bin/env bash
# One command that runs the whole resilience-engine verifier (intent 94, R8):
#   - every resilience unit and invariant test
#   - the family detector golden datasets (including family_income_stops_runway)
#   - the A1 informational-actions tripwire and the advice-rule scan
# Exits non-zero on the first failing layer. Needs `pnpm install` and a built workspace (pnpm build).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== resilience model (api) =="
pnpm --filter @lifekeel/api exec vitest run src/resilience

echo "== detector goldens, informational actions, advice rule (engine) =="
pnpm --filter @lifekeel/engine exec vitest run \
  src/__tests__/family-detector-evals.test.ts \
  src/__tests__/informational-actions.test.ts \
  src/__tests__/advice-rule.test.ts

echo "engine verifier: all layers passed"
