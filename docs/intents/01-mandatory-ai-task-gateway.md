# Intent: mandatory AI task gateway (extends PRD-142)

**Problem** — PRD-142 specified the task/processor registry but enforcement is
still opt-in: budget guard, cost ledger, circuit breaker, and input/output
guards only run inside `callStructured`'s optional `governance` param; raw
`LlmFn` calls bypass everything; the router never invokes the breaker;
`callAzure`/`callOllama` never record usage; routing is model-name prefixes +
prompt keywords; the local-model path has no guards; output guard drops
`tenant_id`. Every §8.15 P0 AI-debt item reduces to this wiring.
Evidence: `packages/platform/src/structured-llm.ts:92-118`, `llm.ts:127-255`,
`local-decision.ts:93-154`.

**Done looks like**
- YAML task-policy registry (§8.4 `AiTaskPolicy`) loaded at boot; production
  fails closed on unknown `task_id`. All 12 §8.4 tasks seeded.
- Every `LlmFn`/`DecisionFn` path requires a resolved policy: token ceilings,
  atomic budget reservation + reconcile, deadline, single retry layer, breaker
  per provider/model/task class, symmetric guards on cloud AND local paths,
  `onUsage` → `CostLedger` for every provider.
- Integration test proving caps/reservation/breaker/deadline/guard/usage fire
  per task — plus a `trust-tier-gate`-style tripwire for calls outside the path.
- Output-guard tenant bug fixed; provider debug `console.log`s removed.

**Constraints**
- Trust tier touched: 0 (restricts behavior, adds no action); approval gate: none new.
- Regulated-advice check: none — plumbing.
- Data/privacy limits: this IS the rule-3 enforcement mechanism; metadata-first
  telemetry only, no prompt/completion capture by default.

**Out of scope** — hosted gateway/proxy product (LiteLLM/Kong — §8.14 defer);
eval/adversarial suite (separate intent family); new AI tasks beyond migrating
existing call sites.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md (or PRD-142
amendment if scope merges cleanly)
