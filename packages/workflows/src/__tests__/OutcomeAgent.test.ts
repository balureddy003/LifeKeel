import { describe, expect, it } from 'vitest'
import { OutcomeAgent, type OutcomeAgentState } from '../agents/OutcomeAgent.js'
import type { AgentCheckpoint, AgentCheckpointer } from '@kairos/runtime'

describe('OutcomeAgent', () => {
  it('checkpoints observations and interrupts at the iteration limit', async () => {
    let checkpoint: AgentCheckpoint<OutcomeAgentState> | null = null
    const savedIterations: number[] = []
    const checkpointer: AgentCheckpointer<OutcomeAgentState> = {
      load: async () => checkpoint,
      save: async value => { checkpoint = value; savedIterations.push(value.iteration) },
    }
    const agent = new OutcomeAgent(
      { plan: async () => ({ type: 'tool', tool: 'observe', reason: 'inspect' }) },
      { execute: async () => ({ observation: 'ok' }) },
      checkpointer,
      2,
    )
    const result = await agent.run({ thread_id: 'run-1', goal_id: 'goal-1', status: 'running', iteration: 0, observations: [] })
    expect(result.status).toBe('human_interrupt')
    expect(result.iteration).toBe(2)
    expect(savedIterations.at(-1)).toBe(2)
  })
})
