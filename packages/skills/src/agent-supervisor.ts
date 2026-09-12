export interface AgentTask {
  id: string
  capability: string
  input: Record<string, unknown>
}
export interface SpecializedAgent {
  id: string
  capabilities: string[]
  run(task: AgentTask): Promise<{ output: Record<string, unknown>; observations?: string[] }>
}
export class AgentSupervisor {
  constructor(private readonly agents: SpecializedAgent[], private readonly maxDelegations = 8) {}
  async execute(tasks: AgentTask[]): Promise<Array<{ task_id: string; agent_id: string; output: Record<string, unknown>; observations: string[] }>> {
    if (tasks.length > this.maxDelegations) throw new Error(`Delegation limit exceeded: ${tasks.length}/${this.maxDelegations}`)
    const results = []
    for (const task of tasks) {
      const agent = this.agents.find(candidate => candidate.capabilities.includes(task.capability))
      if (!agent) throw new Error(`No agent provides capability '${task.capability}'`)
      const result = await agent.run(task)
      results.push({ task_id: task.id, agent_id: agent.id, output: result.output, observations: result.observations ?? [] })
    }
    return results
  }
}
