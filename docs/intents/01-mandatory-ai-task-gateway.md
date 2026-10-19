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

---

## Implementation record (2026-10)

**Shipped.** Registry at `definitions/ai-tasks.yaml` (all 13 §8.4 tasks — the
architecture list contains 13 names, not 12); platform enforcement in
`packages/platform/src/task-gateway.ts` (`governedLlm` / `governedDecide` /
`governedVision`); API wiring in `apps/api/src/ai/task-gateway.ts`
(`initTaskGateway` at boot, `taskLlm/taskLlmFor/taskDecide/taskDecideFor/
taskVision` factories).

**Decisions taken:**

- Call sites keep the plain `LlmFn`/`DecisionFn` signature — they changed only
  *where* the fn comes from. Per-tenant factories (`taskLlmFor`) serve
  constructors that handle many tenants (scorer, move judge).
- `data_boundary: device_only` has no server-side path — `taskLlm` throws by
  construction rather than trusting call sites to check.
- OCR's direct OpenAI SDK vision call (previously the largest bypass) is
  wrapped by `governedVision` — same ceiling/deadline/breaker/guard/usage
  treatment, image parts exempt from the text-token estimate.
- The router's transport `withRetry` remains the single retry layer; the
  breaker counts outcomes via `callOnce` (no nested retry).
- `(task_id, tenant_id)` attribution rides `llmCallContext`
  (AsyncLocalStorage) into `recordUsage` → `CostLedger`, correct under
  concurrent tenants sharing one router.

**Deferred inside this intent (recorded, not silently dropped):**

- Atomic budget reservation + reconcile — pre-call budget check is enforced;
  reservation is the remaining §8.15 debt item 1.
- Processor-terms review-date blocking — fields are required at parse time;
  expiry blocking awaits an operator/legal data source (debt item 2).
- `IntentClassifier` Tier-3 LLM fallback gets no fn — no live `classify()`
  callers exist, so the tier is off rather than ungoverned.
- `eval/` CLIs are allow-listed in the tripwire as offline operator tooling.

**Evidence:** `packages/platform/src/__tests__/task-gateway.test.ts` (27 tests:
parsing, fail-closed, allowlist, ceiling, deadline, breaker, guard symmetry,
tenant attribution, `llmCallContext`, vision); `apps/api/src/__tests__/
ai-task-gateway.test.ts` (11 tests: constructor allowlist, `localDecisionFromEnv`
wrapper check, registry↔call-site consistency, §8.4 seed completeness,
device_only no-path, integration).
