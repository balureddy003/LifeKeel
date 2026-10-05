# @lifekeel/workflows

What `apps/api` genuinely uses from this package today:
- Connector OAuth/credential plumbing (`connector-credentials.ts` shares
  this with the generic multi-provider OAuth flow Gmail uses).
- The event-schema registry (`insights.ts` and others).
- `ActionReceipt`/`ActionReceiptOutcome` — the audit-trail record type shared
  between `apps/api/src/routes/insights.ts` and
  `apps/api/src/actions/action-executor.ts`.

**The original LangGraph-based `WorkflowEngine`/`WorkflowLoader` — copied
wholesale from kairos-ai — was deleted on 2026-09-12** (see `SECURITY.md`).
It wasn't dangerous because step execution is a bad idea; it was dangerous
because it ran unconditionally at boot: `node-cron`-scheduling 25
YAML-defined workflows, polling a "goal autonomy" scheduler every 15
minutes, checking a live auto-trading opt-in — all with zero product
surface to see or manage any of it.

## `src/engine/` — the rebuilt workflow engine

A small, general-purpose, Mongo-backed durable step-sequence executor —
`defineWorkflow()` + `WorkflowEngine` — built to avoid the exact failure
mode above:

- **Nothing runs unless application code explicitly calls it.** No cron, no
  auto-registration, no boot-time scheduling. A workflow only starts when
  some route handler calls `new WorkflowEngine(db).start(def, {...})`.
- **The human-approval gate is structural, not a convention.**
  `defineWorkflow()` refuses (throws) to build a definition where a step
  marked `sideEffect: true` isn't preceded by an `approval_gate` step — see
  `CLAUDE.md`'s trust-tier rule. A future feature literally cannot wire an
  irreversible action past this without the engine rejecting the
  definition at startup.
- **Durable and idempotent.** Every step transition is a single atomic
  Mongo write (`workflow_runs`, precondition-gated, same idiom as
  `apps/api/src/routes/insights.ts`'s approve/retry-execution); step
  results are recorded in `workflow_step_runs` keyed by `{run_id, step_id}`
  so a crash-and-resume, or an explicit retry of a failed run, never
  re-executes a step whose side effect already succeeded (same
  claim-then-execute pattern as `action-executor.ts`).
- **Linear steps with simple named-jump branching, not a full graph** — the
  two real multi-step flows in this codebase so far (insight
  approve→execute, PRD-108 life-event playbooks) don't need a DAG; a step
  can set `nextStepId` to jump, defaulting to "next in the array."

Nothing in `apps/api` constructs a `WorkflowEngine` yet — this ships as
tested, ready-to-use library code (see `src/engine/__tests__/`) for the
*next* multi-step feature to adopt, not a retrofit of PRD-103/PRD-108,
which already work without it. Don't wire this into `server.ts` as a
boot-time scheduler — that's the exact mistake this rebuild exists to avoid.
