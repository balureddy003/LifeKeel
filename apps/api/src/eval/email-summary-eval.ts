import { pathToFileURL } from 'node:url'
import { scanText } from '@lifekeel/engine'
import { createLocalDecisionFn, type DecisionFn } from '@lifekeel/platform'
import { classifyEmail } from '../email/classify.js'
import { LABELLED_EMAILS } from '../email/__fixtures__/labelled-emails.js'
import { ungroundedNumbers, volunteeredProviders } from '../local-model.js'
import { evalAuthHeaders, type GateResult } from './local-model-eval.js'

/**
 * email.policy_summary.v1 go/no-go: `node dist/eval/email-summary-eval.js` with
 * LOCAL_JUDGE_BASE_URL set. The summary and the policy facts come from the same
 * classifier call as relevance (email.policy_relevance.v1 covers whether an email
 * is relevant; local-model-eval.ts gates that), so this measures the other half:
 * for each policy email, is the inbox-card summary safe and grounded, and does
 * the extracted policy match what the email states?
 *
 * Gates: no summary gives advice, names a provider the email did not, or states
 * a figure not in the email; every policy email gets a summary; extracted
 * fields (provider, type, renewal date, premium) are right at least
 * MIN_FIELD_ACCURACY of the time they are labelled.
 */
export const MIN_FIELD_ACCURACY = 0.8

export interface EmailSummaryReport {
  model: string
  unsafe: string[]
  missingSummary: string[]
  fieldsRight: number
  fieldsLabelled: number
  failed: string[]
  gates: GateResult[]
  passed: boolean
}

export async function runEmailSummaryEval(
  decide: DecisionFn,
  model: string,
): Promise<EmailSummaryReport> {
  const never = async () => {
    throw new Error('cloud LLM must not be called in the eval')
  }
  const unsafe: string[] = []
  const missingSummary: string[] = []
  const failed: string[] = []
  let fieldsRight = 0
  let fieldsLabelled = 0

  for (const e of LABELLED_EMAILS.filter((x) => x.isFinancial)) {
    const r = await classifyEmail(
      never,
      {
        uid: 1,
        messageId: e.name,
        from: e.from,
        subject: e.subject,
        date: new Date('2026-10-01'),
        textSnippet: e.textSnippet,
        attachments: [],
      },
      { decide },
    )
    if (r.failed) {
      failed.push(e.name)
      continue
    }
    const source = `${e.subject}\n${e.textSnippet}`
    const summary = `${r.summary} ${r.actionLabel}`.trim()
    if (!r.summary.trim()) missingSummary.push(e.name)
    if (
      scanText(summary, { generated: true }).length > 0 ||
      volunteeredProviders(summary, source).length > 0 ||
      ungroundedNumbers(summary, source).length > 0
    )
      unsafe.push(e.name)

    const want = e.policy
    if (!want) continue
    const got = r.policy ?? {}
    if (want.provider !== undefined) {
      fieldsLabelled += 1
      if (got.provider?.toLowerCase().includes(want.provider.toLowerCase())) fieldsRight += 1
    }
    if (want.type !== undefined) {
      fieldsLabelled += 1
      if (got.type === want.type) fieldsRight += 1
    }
    if (want.renewalDate !== undefined) {
      fieldsLabelled += 1
      if (got.renewalDate === want.renewalDate) fieldsRight += 1
    }
    if (want.monthlyPremium !== undefined) {
      fieldsLabelled += 1
      if (got.monthlyPremium === want.monthlyPremium) fieldsRight += 1
    }
  }

  const accuracy = fieldsLabelled === 0 ? 1 : fieldsRight / fieldsLabelled
  const gates: GateResult[] = [
    {
      name: 'summaries never give advice, name an unmentioned provider, or invent a figure',
      passed: unsafe.length === 0,
      detail: unsafe.length ? unsafe.join(', ') : 'none',
    },
    {
      name: 'every policy email gets a summary',
      passed: missingSummary.length === 0,
      detail: missingSummary.length ? missingSummary.join(', ') : 'all summarised',
    },
    {
      name: `extracted policy fields at least ${MIN_FIELD_ACCURACY} accurate`,
      passed: accuracy >= MIN_FIELD_ACCURACY,
      detail: `${fieldsRight}/${fieldsLabelled}`,
    },
    {
      name: 'model produced a verdict for every policy email',
      passed: failed.length === 0,
      detail: failed.length ? failed.join(', ') : 'all classified',
    },
  ]
  return {
    model,
    unsafe,
    missingSummary,
    fieldsRight,
    fieldsLabelled,
    failed,
    gates,
    passed: gates.every((g) => g.passed),
  }
}

export function formatEmailSummaryReport(r: EmailSummaryReport): string {
  const lines = [`Email summary eval: ${r.model}`, '']
  for (const g of r.gates) lines.push(`${g.passed ? 'PASS' : 'FAIL'}  ${g.name}  (${g.detail})`)
  lines.push('', r.passed ? 'RESULT: model meets the gates' : 'RESULT: model FAILS the gates')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const baseUrl = process.env['LOCAL_JUDGE_BASE_URL']
  if (!baseUrl) {
    console.error('Set LOCAL_JUDGE_BASE_URL to the Ollama service.')
    process.exit(2)
  }
  const model = process.env['LOCAL_JUDGE_MODEL'] || 'qwen2.5:7b'
  const getHeaders = await evalAuthHeaders(baseUrl)
  const report = await runEmailSummaryEval(
    createLocalDecisionFn({ baseUrl, model, timeoutMs: 240_000, maxConcurrent: 1, getHeaders }),
    model,
  )
  console.log(formatEmailSummaryReport(report))
  process.exit(report.passed ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
