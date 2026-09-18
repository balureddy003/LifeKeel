import type { WorkflowDefinition } from './types.js'

/**
 * Validates and returns a workflow definition. Throws at call time — not at
 * step-run time — if the definition would let a sideEffect step execute
 * without a human approval gate first. This is the structural half of
 * CLAUDE.md's trust-tier rule: an approval gate is not a convention a future
 * feature could forget, it's a precondition the engine refuses to skip.
 */
export function defineWorkflow<TState>(def: WorkflowDefinition<TState>): WorkflowDefinition<TState> {
  const seenIds = new Set<string>()
  let gateSeen = false

  for (const step of def.steps) {
    if (seenIds.has(step.id)) {
      throw new Error(`defineWorkflow(${def.id}): duplicate step id "${step.id}"`)
    }
    seenIds.add(step.id)

    if (step.kind === 'approval_gate') {
      if (!step.describeForApproval) {
        throw new Error(`defineWorkflow(${def.id}): approval_gate step "${step.id}" needs describeForApproval`)
      }
      if (step.run) {
        throw new Error(`defineWorkflow(${def.id}): approval_gate step "${step.id}" must not define run`)
      }
      gateSeen = true
      continue
    }

    if (!step.run) {
      throw new Error(`defineWorkflow(${def.id}): action step "${step.id}" needs run`)
    }
    if (step.sideEffect && !gateSeen) {
      throw new Error(
        `defineWorkflow(${def.id}): sideEffect step "${step.id}" has no approval_gate step before it — ` +
        'an irreversible action can never run without a preceding human approval gate (CLAUDE.md trust tiers).',
      )
    }
  }

  return def
}
