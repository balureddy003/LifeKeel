import { describe, expect, it } from 'vitest'
import type { DecisionFn } from '@agentoak/platform'
import { LABELLED_JUDGE_CASES } from '../../delivery/__fixtures__/labelled-judge-cases.js'
import { LABELLED_EMAILS } from '../../email/__fixtures__/labelled-emails.js'
import { evalAuthHeaders, formatReport, runLocalModelEval } from '../local-model-eval.js'

type Req = { prompt: string; jsonSchema: { properties: Record<string, unknown> } }
const isJudge = (r: Req) => 'coherent' in r.jsonSchema.properties

const emptyPolicy = null
const emailVerdict = (isFinancial: boolean) => ({
  is_financial: isFinancial, summary: isFinancial ? 's' : '', action_label: isFinancial ? 'Review' : '',
  action_type: 'info', priority: 'low', policy: emptyPolicy,
})
const checklist = (over: Record<string, unknown> = {}) => ({
  coherent: true, grounded: true, actionable: true, gives_advice_or_names_provider: false,
  contains_pii_or_credentials: false, uncertain: false, feedback: '', ...over,
})
const wrap = (value: unknown) => ({ value, model: 'stub', latency_ms: 1 })

/** A model that answers every case correctly. */
const correct: DecisionFn = (async (req: Req) => {
  if (isJudge(req)) {
    const c = LABELLED_JUDGE_CASES.find(x => req.prompt.includes(x.reasoning.slice(0, 40)))!
    return wrap(checklist(c.kind === 'unsafe' ? { gives_advice_or_names_provider: true } : c.kind === 'weak' ? { coherent: false, actionable: false } : {}))
  }
  const e = LABELLED_EMAILS.find(x => req.prompt.includes(x.subject))!
  return wrap(emailVerdict(e.isFinancial))
}) as unknown as DecisionFn

/** The failure we measured on qwen2.5:1.5b: approves everything, including unsafe copy. */
const yesMan: DecisionFn = (async (req: Req) =>
  wrap(isJudge(req) ? checklist() : emailVerdict(true))) as unknown as DecisionFn

describe('runLocalModelEval gates', () => {
  it('passes a model that gets every case right', async () => {
    const report = await runLocalModelEval(correct, 'stub-correct')
    expect(report.gates.filter(g => !g.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('rejects a model that approves everything, naming the unsafe cases it approved', async () => {
    const report = await runLocalModelEval(yesMan, 'stub-yes-man')
    expect(report.passed).toBe(false)
    const unsafeGate = report.gates.find(g => g.name.startsWith('judge: unsafe'))!
    expect(unsafeGate.passed).toBe(false)
    for (const c of LABELLED_JUDGE_CASES.filter(x => x.kind === 'unsafe')) expect(unsafeGate.detail).toContain(c.name)
    expect(report.gates.find(g => g.name.startsWith('email: no false positives'))!.passed).toBe(false)
  })

  it('treats an unreachable model as a failure, not as silence: errors are not passes and not classifications', async () => {
    const down = (async () => { throw new Error('connection refused') }) as unknown as DecisionFn
    const report = await runLocalModelEval(down, 'stub-down')
    expect(report.passed).toBe(false)
    expect(Object.values(report.judge.decisions).every(d => d === 'error')).toBe(true)
    expect(report.gates.find(g => g.name.startsWith('email: model produced'))!.passed).toBe(false)
  })

  it('does not gate on the known-limitation case or the weak case', async () => {
    // Approve only the known-limit and weak cases: unsafe still blocked, good still approved.
    const lenient = (async (req: Req) => {
      if (!isJudge(req)) return wrap(emailVerdict(LABELLED_EMAILS.find(x => req.prompt.includes(x.subject))!.isFinancial))
      const c = LABELLED_JUDGE_CASES.find(x => req.prompt.includes(x.reasoning.slice(0, 40)))!
      return wrap(checklist(c.kind === 'unsafe' ? { gives_advice_or_names_provider: true } : {}))
    }) as unknown as DecisionFn
    expect((await runLocalModelEval(lenient, 'stub-lenient')).passed).toBe(true)
  })

  it('formats a readable report that states the verdict', async () => {
    const text = formatReport(await runLocalModelEval(yesMan, 'stub-yes-man'))
    expect(text).toContain('Local model eval: stub-yes-man')
    expect(text).toContain('FAIL  judge: unsafe copy is never approved')
    expect(text).toContain('do not use it')
  })
})

describe('evalAuthHeaders', () => {
  it('uses a ready-made bearer token when given one (CI)', async () => {
    const get = await evalAuthHeaders('https://judge.run.app', { LOCAL_JUDGE_BEARER: 'tok' } as NodeJS.ProcessEnv)
    expect(await get!()).toEqual({ Authorization: 'Bearer tok' })
  })

  it('sends no auth for a plain local Ollama', async () => {
    expect(await evalAuthHeaders('http://127.0.0.1:11434', {} as NodeJS.ProcessEnv)).toBeUndefined()
  })

  it('prefers the explicit bearer over metadata-server auth', async () => {
    const get = await evalAuthHeaders('https://judge.run.app', { LOCAL_JUDGE_BEARER: 'tok', LOCAL_JUDGE_AUTH: 'cloudrun-iam' } as NodeJS.ProcessEnv)
    expect(await get!()).toEqual({ Authorization: 'Bearer tok' })
  })
})
