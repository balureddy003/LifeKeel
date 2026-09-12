export interface GoalDecompositionTraceEntry {
  tool: 'list_available_detectors' | 'list_connected_connectors' | 'validate_goal_draft' | 'call_structured'
  called_at: string
  result_summary: string
}

export interface GoalDecompositionTools<TDraft> {
  listAvailableDetectors(): Promise<unknown[]>
  listConnectedConnectors(): Promise<unknown[]>
  validateGoalDraft(draft: TDraft): Promise<string[]>
}

export interface GoalDecompositionResult<TDraft> {
  draft: TDraft | null
  trace: GoalDecompositionTraceEntry[]
  errors: string[]
  requires_confirmation: true
}

export interface GoalDecompositionAgentOptions<TDraft> {
  tools: GoalDecompositionTools<TDraft>
  callStructured(prompt: string): Promise<TDraft>
  maxValidationAttempts?: number
}

export class GoalDecompositionAgent<TDraft> {
  constructor(private readonly options: GoalDecompositionAgentOptions<TDraft>) {}

  async decompose(intent: string): Promise<GoalDecompositionResult<TDraft>> {
    const trace: GoalDecompositionTraceEntry[] = []
    const record = (tool: GoalDecompositionTraceEntry['tool'], result: unknown) => {
      trace.push({
        tool,
        called_at: new Date().toISOString(),
        result_summary: Array.isArray(result)
          ? `${result.length} result(s)`
          : String(result).slice(0, 200),
      })
    }

    const [detectors, connectors] = await Promise.all([
      this.options.tools.listAvailableDetectors(),
      this.options.tools.listConnectedConnectors(),
    ])
    record('list_available_detectors', detectors)
    record('list_connected_connectors', connectors)

    let errors: string[] = []
    let draft: TDraft | null = null
    const attempts = Math.max(1, this.options.maxValidationAttempts ?? 2)
    for (let attempt = 0; attempt < attempts; attempt++) {
      const prompt = JSON.stringify({
        intent,
        detectors,
        connectors,
        previous_validation_errors: errors,
        instruction: 'Return a structured Goal draft for explicit user confirmation. Do not create it.',
      })
      draft = await this.options.callStructured(prompt)
      record('call_structured', `attempt ${attempt + 1}`)
      errors = await this.options.tools.validateGoalDraft(draft)
      record('validate_goal_draft', errors.length === 0 ? 'valid' : errors.join('; '))
      if (errors.length === 0) break
    }

    return {
      draft: errors.length === 0 ? draft : null,
      trace,
      errors,
      requires_confirmation: true,
    }
  }
}
