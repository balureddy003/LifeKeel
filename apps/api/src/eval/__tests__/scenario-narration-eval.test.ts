import { describe, expect, it } from 'vitest'
import { SCENARIO_NARRATION_CASES } from '../__fixtures__/scenario-narration-cases.js'
import {
  MAX_NARRATION_BLOCK_RATE,
  buildNarrationPrompt,
  formatNarrationReport,
  runNarrationEval,
} from '../scenario-narration-eval.js'

/** A model that restates what the prompt says and nothing more. */
const faithful = async (_system: string, prompt: string): Promise<string> => {
  const first = prompt.split('\n').find((l) => l.startsWith('Projected monthly surplus'))
  return `On the figures provided: ${first ?? 'see the numbers above'} That is information about what is on file, not a recommendation.`
}

describe('runNarrationEval', () => {
  it('passes a model that only narrates figures in the prompt', async () => {
    const r = await runNarrationEval(faithful)
    expect(r.results.filter((x) => x.reasons.length)).toEqual([])
    expect(r.passed).toBe(true)
  })

  it('flags a model that invents a figure', async () => {
    const r = await runNarrationEval(async () => 'You will have £48,213.55 saved after five years.')
    expect(r.passed).toBe(false)
    expect(r.results[0]!.reasons.join()).toMatch(/ungrounded_numbers/)
  })

  it('flags a model that steers to a named provider', async () => {
    const r = await runNarrationEval(async () => 'Moving your cover to Aviva would help.')
    expect(r.results.some((x) => /provider_steering/.test(x.reasons.join()))).toBe(true)
  })

  it('flags an empty answer and counts a model error against the model', async () => {
    expect((await runNarrationEval(async () => '  ')).results[0]!.reasons).toEqual(['empty'])
    const r = await runNarrationEval(async () => {
      throw new Error('timeout')
    })
    expect(r.passed).toBe(false)
    expect(r.results[0]!.reasons[0]).toMatch(/^model_error/)
  })

  it('every golden case carries the exact calculator numbers in its prompt', () => {
    for (const c of SCENARIO_NARRATION_CASES) {
      const p = buildNarrationPrompt(c)
      expect(p).toContain(c.question)
      expect(p).toContain((c.result.projectedMonthlySurplusMinor / 100).toFixed(2).replace('-', ''))
    }
    expect(MAX_NARRATION_BLOCK_RATE).toBeLessThanOrEqual(0.25)
  })

  it('formats a readable report', async () => {
    const text = formatNarrationReport(await runNarrationEval(faithful))
    expect(text).toMatch(/RESULT: pass/)
  })
})
