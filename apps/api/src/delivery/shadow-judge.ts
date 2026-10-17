import { decideScores, JudgeScoresSchema, type JudgeEvaluator, type JudgeInput } from '@lifekeel/engine'

/**
 * Shadow mode for judge evaluators: the primary evaluator stays authoritative
 * (its scores and errors are returned untouched) while a candidate runs behind it
 * on the same live inputs, and the two decisions are compared and recorded. This is
 * how a cheaper or self-hosted judge is validated on real traffic before it is
 * allowed to decide anything. The shadow can never change a delivery outcome or
 * delay it: it starts after the primary has answered and is not awaited.
 */

export type ShadowOutcome =
  | 'agree'
  /** Shadow would deliver something the primary blocked or sent for rewrite: the dangerous direction. */
  | 'shadow_more_permissive'
  /** Shadow is stricter than the primary: costs coverage and review load, not safety. */
  | 'shadow_stricter'
  /** Shadow errored or was uncertain, so there is nothing to compare. */
  | 'shadow_error'
  /** Skipped because too many shadow calls were already in flight. */
  | 'dropped'

export interface ShadowRecord {
  outcome: ShadowOutcome
  tenant_id: string
  insight_id: string
  detector_id: string
  primary_decision: string
  shadow_decision?: string
  shadow_latency_ms?: number
  shadow_error?: string
}

const STRICTNESS = { pass: 0, rewrite: 1, block: 2 } as const

export function compareDecisions(primary: keyof typeof STRICTNESS, shadow: keyof typeof STRICTNESS): ShadowOutcome {
  if (primary === shadow) return 'agree'
  return STRICTNESS[shadow] < STRICTNESS[primary] ? 'shadow_more_permissive' : 'shadow_stricter'
}

export interface ShadowOptions {
  /** Called once per comparison. Must not throw into the caller; errors are swallowed. */
  record: (r: ShadowRecord) => void | Promise<void>
  /** Bound on concurrent shadow calls so a slow candidate cannot pile up behind live traffic. Default 2. */
  maxInFlight?: number
}

export function withShadow(primary: JudgeEvaluator, shadow: JudgeEvaluator, opts: ShadowOptions): JudgeEvaluator {
  const maxInFlight = opts.maxInFlight ?? 2
  let inFlight = 0

  const emit = (r: ShadowRecord) => {
    try { void Promise.resolve(opts.record(r)).catch(() => {}) } catch { /* recording must never affect delivery */ }
  }

  return async (input: JudgeInput) => {
    const primaryScores = await primary(input) // errors propagate: the primary decides, as before
    const base = {
      tenant_id: input.insight.tenant_id ?? 'unknown',
      insight_id: input.insight.id,
      detector_id: input.insight.detector_id,
    }

    let primaryDecision: keyof typeof STRICTNESS
    try {
      primaryDecision = decideScores(JudgeScoresSchema.parse(primaryScores))
    } catch {
      return primaryScores // the judge will reject these scores itself; nothing to compare
    }

    if (inFlight >= maxInFlight) {
      emit({ ...base, outcome: 'dropped', primary_decision: primaryDecision })
      return primaryScores
    }

    inFlight += 1
    const started = Date.now()
    void (async () => {
      try {
        const shadowDecision = decideScores(JudgeScoresSchema.parse(await shadow(input)))
        emit({
          ...base,
          outcome: compareDecisions(primaryDecision, shadowDecision),
          primary_decision: primaryDecision,
          shadow_decision: shadowDecision,
          shadow_latency_ms: Date.now() - started,
        })
      } catch (err) {
        emit({
          ...base,
          outcome: 'shadow_error',
          primary_decision: primaryDecision,
          shadow_latency_ms: Date.now() - started,
          shadow_error: (err as Error).name,
        })
      } finally {
        inFlight -= 1
      }
    })()

    return primaryScores
  }
}
