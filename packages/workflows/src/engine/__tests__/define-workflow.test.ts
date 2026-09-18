import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineWorkflow } from '../define-workflow.js'
import type { WorkflowStep } from '../types.js'

const stateSchema = z.object({ done: z.boolean().default(false) })
type State = z.infer<typeof stateSchema>

const gate: WorkflowStep<State> = {
  id: 'gate',
  kind: 'approval_gate',
  describeForApproval: () => 'approve me',
}

const sideEffectAction: WorkflowStep<State> = {
  id: 'send',
  kind: 'action',
  sideEffect: true,
  run: async () => ({ state: { done: true } }),
}

const plainAction: WorkflowStep<State> = {
  id: 'compute',
  kind: 'action',
  run: async () => ({ state: {} }),
}

describe('defineWorkflow — structural safety guarantee', () => {
  it('throws when a sideEffect step has no approval_gate step before it', () => {
    expect(() => defineWorkflow<State>({ id: 'w1', stateSchema, steps: [sideEffectAction] })).toThrow(/approval_gate/)
  })

  it('accepts a sideEffect step preceded by an approval_gate step', () => {
    expect(() => defineWorkflow<State>({ id: 'w2', stateSchema, steps: [gate, sideEffectAction] })).not.toThrow()
  })

  it('accepts plain action steps with no gate at all (no side effects to guard)', () => {
    expect(() => defineWorkflow<State>({ id: 'w3', stateSchema, steps: [plainAction, plainAction2()] })).not.toThrow()
  })

  it('rejects duplicate step ids', () => {
    expect(() => defineWorkflow<State>({ id: 'w4', stateSchema, steps: [plainAction, plainAction] })).toThrow(/duplicate/)
  })

  it('rejects an approval_gate step missing describeForApproval', () => {
    const badGate = { id: 'gate', kind: 'approval_gate' as const }
    expect(() => defineWorkflow<State>({ id: 'w5', stateSchema, steps: [badGate] })).toThrow(/describeForApproval/)
  })

  it('rejects an approval_gate step that also defines run', () => {
    const badGate: WorkflowStep<State> = { ...gate, run: async () => ({ state: {} }) }
    expect(() => defineWorkflow<State>({ id: 'w6', stateSchema, steps: [badGate] })).toThrow(/must not define run/)
  })

  it('rejects an action step missing run', () => {
    const badAction = { id: 'a', kind: 'action' as const }
    expect(() => defineWorkflow<State>({ id: 'w7', stateSchema, steps: [badAction] })).toThrow(/needs run/)
  })

  function plainAction2(): WorkflowStep<State> {
    return { id: 'compute2', kind: 'action', run: async () => ({ state: {} }) }
  }
})
