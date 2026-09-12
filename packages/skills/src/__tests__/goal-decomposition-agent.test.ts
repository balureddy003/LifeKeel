import { describe, expect, it, vi } from 'vitest'
import { GoalDecompositionAgent } from '../goal-decomposition-agent.js'

describe('GoalDecompositionAgent', () => {
  it('uses tools, self-corrects, and only returns a draft for confirmation', async () => {
    const callStructured = vi.fn()
      .mockResolvedValueOnce({ name: 'Reduce churn', evidence: [] })
      .mockResolvedValueOnce({ name: 'Reduce churn', evidence: ['subscription.cancelled'] })
    const agent = new GoalDecompositionAgent<{ name: string; evidence: string[] }>({
      tools: {
        listAvailableDetectors: async () => [{ id: 'churn-risk' }],
        listConnectedConnectors: async () => [{ id: 'stripe' }],
        validateGoalDraft: async draft => draft.evidence.length > 0 ? [] : ['evidence required'],
      },
      callStructured,
    })

    const result = await agent.decompose('Reduce churn before Q3 end')

    expect(result.draft).toEqual({ name: 'Reduce churn', evidence: ['subscription.cancelled'] })
    expect(result.requires_confirmation).toBe(true)
    expect(callStructured).toHaveBeenCalledTimes(2)
    expect(result.trace.map(entry => entry.tool)).toContain('validate_goal_draft')
  })

  it('refuses an untrackable goal after validation attempts', async () => {
    const agent = new GoalDecompositionAgent<{ name: string }>({
      tools: {
        listAvailableDetectors: async () => [],
        listConnectedConnectors: async () => [],
        validateGoalDraft: async () => ['No available evidence source'],
      },
      callStructured: async () => ({ name: 'Untrackable' }),
    })

    const result = await agent.decompose('Track an unavailable metric')
    expect(result.draft).toBeNull()
    expect(result.errors).toEqual(['No available evidence source'])
  })
})
