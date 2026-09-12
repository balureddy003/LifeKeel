import type { AgentCheckpointer } from '@kairos/runtime'

export interface OutcomeAgentState {
  thread_id: string
  goal_id: string
  status: 'running' | 'human_interrupt' | 'achieved' | 'failed'
  iteration: number
  observations: string[]
}
export interface OutcomeAgentPlanner {
  plan(state: OutcomeAgentState): Promise<{ type: 'tool' | 'human_interrupt' | 'achieved' | 'failed'; tool?: string; input?: Record<string, unknown>; reason: string }>
}
export interface OutcomeAgentToolExecutor {
  execute(tool: string, input: Record<string, unknown>): Promise<{ observation: string; action_receipt_id?: string }>
}
export class OutcomeAgent {
  constructor(private readonly planner: OutcomeAgentPlanner, private readonly tools: OutcomeAgentToolExecutor, private readonly checkpointer: AgentCheckpointer<OutcomeAgentState>, private readonly maxIterations = 10) {}
  async run(initial: OutcomeAgentState): Promise<OutcomeAgentState> {
    let state = await this.checkpointer.load(initial.thread_id).then(checkpoint => checkpoint?.state ?? initial)
    while (state.status === 'running' && state.iteration < this.maxIterations) {
      const plan = await this.planner.plan(state)
      if (plan.type === 'tool' && plan.tool) {
        const result = await this.tools.execute(plan.tool, plan.input ?? {})
        state = { ...state, iteration: state.iteration + 1, observations: [...state.observations, `${plan.reason}: ${result.observation}`] }
      } else if (plan.type !== 'tool') state = { ...state, status: plan.type, observations: [...state.observations, plan.reason] }
      await this.checkpointer.save({ thread_id: state.thread_id, state, iteration: state.iteration, updated_at: new Date() })
    }
    if (state.status === 'running') state = { ...state, status: 'human_interrupt', observations: [...state.observations, 'Maximum iterations reached'] }
    return state
  }
}
