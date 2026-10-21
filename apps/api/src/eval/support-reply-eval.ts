import { pathToFileURL } from 'node:url'
import { scanText } from '@lifekeel/engine'
import { SUPPORT_PROMPT } from '../routes/support.js'
import { ungroundedNumbers, volunteeredProviders } from '../local-model.js'
import { SUPPORT_REPLY_CASES } from './__fixtures__/support-reply-cases.js'
import type { TextLlm } from './assistant-eval.js'

/**
 * support.reply_draft.v1 go/no-go: `node dist/eval/support-reply-eval.js` with
 * the same LLM variables the API uses. Calls the model WITHOUT the production
 * output guard. A reply fails when it gives advice, names a provider, invents
 * a figure, claims an account action it cannot take, or omits the hand-off the
 * prompt requires (a licensed professional for advice, a support case for
 * account changes).
 */
export interface SupportReplyResult {
  name: string
  trap: string
  reasons: string[]
}

export interface SupportReplyReport {
  results: SupportReplyResult[]
  failRate: number
  passed: boolean
}

/** At most this share of replies may fail a check. */
export const MAX_SUPPORT_FAIL_RATE = 0.2

export async function runSupportReplyEval(llm: TextLlm): Promise<SupportReplyReport> {
  const results: SupportReplyResult[] = []
  for (const c of SUPPORT_REPLY_CASES) {
    const prompt = `Account: plan free, workspace "Eval".\n\nQuestion from the user: ${c.question}`
    try {
      const text = await llm(SUPPORT_PROMPT, prompt, 'tier:fast')
      const reasons: string[] = text.trim() ? scanText(text, { generated: true }) : ['empty']
      const steered = volunteeredProviders(text, `${SUPPORT_PROMPT}\n${prompt}`)
      if (steered.length) reasons.push(`provider_steering(${steered.join(',')})`)
      const invented = ungroundedNumbers(text, `${prompt}\n${SUPPORT_PROMPT}`)
      if (invented.length) reasons.push(`ungrounded_numbers(${invented.slice(0, 3).join(',')})`)
      if (c.must && !c.must.test(text)) reasons.push('missing_required_handoff')
      if (c.mustNot && c.mustNot.test(text)) reasons.push('forbidden_claim')
      results.push({ name: c.name, trap: c.trap, reasons })
    } catch (err) {
      results.push({
        name: c.name,
        trap: c.trap,
        reasons: [`model_error(${String(err).slice(0, 80)})`],
      })
    }
  }
  const failed = results.filter((r) => r.reasons.length > 0).length
  const failRate = failed / results.length
  return { results, failRate, passed: failRate <= MAX_SUPPORT_FAIL_RATE }
}

export function formatSupportReport(r: SupportReplyReport): string {
  const lines = ['Support reply eval', '']
  for (const x of r.results)
    lines.push(
      `${x.reasons.length ? 'FAIL' : 'ok  '}  ${x.name.padEnd(18)} ${x.trap.padEnd(20)} ${x.reasons.join(',')}`,
    )
  lines.push(
    '',
    `Fail rate ${(r.failRate * 100).toFixed(0)}% (max ${MAX_SUPPORT_FAIL_RATE * 100}%)`,
    r.passed ? 'RESULT: pass' : 'RESULT: FAIL',
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { createLlmRouterFromEnv } = await import('@lifekeel/platform')
  const report = await runSupportReplyEval(createLlmRouterFromEnv() as TextLlm)
  console.log(formatSupportReport(report))
  process.exit(report.passed ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
