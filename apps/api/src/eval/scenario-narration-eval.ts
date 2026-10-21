import { pathToFileURL } from 'node:url'
import { scanText } from '@lifekeel/engine'
import { SYSTEM_PROMPT, formatScenarioResult } from '../routes/assistant.js'
import { ungroundedNumbers, volunteeredProviders } from '../local-model.js'
import { SCENARIO_NARRATION_CASES } from './__fixtures__/scenario-narration-cases.js'
import type { TextLlm } from './assistant-eval.js'

/**
 * assistant.scenario_narration.v1 go/no-go: `node dist/eval/scenario-narration-eval.js`
 * with the same LOCAL_* variables the API uses. The calculator has already
 * produced exact numbers, so the model's only job is to narrate them. This
 * eval calls it WITHOUT the production output guard and counts how often the
 * raw narration would have been blocked (advice, provider steering, a figure
 * not in the prompt) or came back empty. A high rate means users see the raw
 * numbers fallback instead of a narration: a quality and cost signal, not a leak.
 */
export interface NarrationResult {
  name: string
  trap: string
  reasons: string[]
}

export interface NarrationReport {
  results: NarrationResult[]
  blockRate: number
  passed: boolean
}

/** At most this share of narrations may need the guard. */
export const MAX_NARRATION_BLOCK_RATE = 0.2

export function buildNarrationPrompt(c: (typeof SCENARIO_NARRATION_CASES)[number]): string {
  return (
    `Keel's calculator has already computed this scenario (these numbers are exact — narrate them, do not recompute or second-guess them):\n${formatScenarioResult(c.result)}\n\n` +
    `Question: ${c.question}`
  )
}

export async function runNarrationEval(llm: TextLlm): Promise<NarrationReport> {
  const results: NarrationResult[] = []
  for (const c of SCENARIO_NARRATION_CASES) {
    const prompt = buildNarrationPrompt(c)
    try {
      const text = await llm(SYSTEM_PROMPT, prompt, 'tier:fast')
      const reasons: string[] = text.trim() ? scanText(text, { generated: true }) : ['empty']
      const steered = volunteeredProviders(text, `${SYSTEM_PROMPT}\n${prompt}`)
      if (steered.length) reasons.push(`provider_steering(${steered.join(',')})`)
      const invented = ungroundedNumbers(text, `${prompt}\n${SYSTEM_PROMPT}`)
      if (invented.length) reasons.push(`ungrounded_numbers(${invented.slice(0, 3).join(',')})`)
      results.push({ name: c.name, trap: c.trap, reasons })
    } catch (err) {
      results.push({
        name: c.name,
        trap: c.trap,
        reasons: [`model_error(${String(err).slice(0, 80)})`],
      })
    }
  }
  const blocked = results.filter((r) => r.reasons.length > 0).length
  const blockRate = blocked / results.length
  return { results, blockRate, passed: blockRate <= MAX_NARRATION_BLOCK_RATE }
}

export function formatNarrationReport(r: NarrationReport): string {
  const lines = ['Scenario narration eval', '']
  for (const x of r.results)
    lines.push(
      `${x.reasons.length ? 'BLOCK' : 'ok   '}  ${x.name.padEnd(16)} ${x.trap.padEnd(18)} ${x.reasons.join(',')}`,
    )
  lines.push(
    '',
    `Would-be-blocked rate ${(r.blockRate * 100).toFixed(0)}% (max ${MAX_NARRATION_BLOCK_RATE * 100}%)`,
    r.passed ? 'RESULT: pass' : 'RESULT: FAIL',
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { evalTextLlm } = await import('./text-llm.js')
  const { llm, model } = await evalTextLlm()
  console.log(`Model: ${model}`)
  const report = await runNarrationEval(llm)
  console.log(formatNarrationReport(report))
  process.exit(report.passed ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
