import { describe, expect, it, vi } from 'vitest'
import type { DecisionFn, LlmFn } from '@lifekeel/platform'
import {
  EMAIL_CLASSIFY_SYSTEM_PROMPT,
  EMAIL_RELEVANCE_SYSTEM_PROMPT,
  askRelevance,
  classifyEmail,
  emailUserPrompt,
  type EmailFunnelStage,
} from '../classify.js'
import { LABELLED_EMAILS } from '../__fixtures__/labelled-emails.js'

const named = (n: string) => LABELLED_EMAILS.find((e) => e.name === n)!
const fetched = (e: (typeof LABELLED_EMAILS)[number]) => ({
  uid: 1,
  messageId: e.name,
  from: e.from,
  subject: e.subject,
  date: new Date('2026-10-01'),
  textSnippet: e.textSnippet,
  attachments: [],
})

const never: LlmFn = async () => {
  throw new Error('the cloud path must not be called')
}
const wrap = (value: unknown) => ({ value, model: 'stub', latency_ms: 1 })
const detail = (over: Record<string, unknown> = {}) => ({
  is_financial: true,
  summary: 'Your policy renews soon.',
  action_label: 'Review cover',
  action_type: 'renew',
  priority: 'medium',
  policy: { provider: 'BrightLife', type: 'life' },
  ...over,
})

/** A decide that answers the relevance question and the full classification differently. */
function decideFor(relevance: 'yes' | 'no' | Error, full: unknown = detail()) {
  return vi.fn(async (req: { system: string }) => {
    if (req.system === EMAIL_RELEVANCE_SYSTEM_PROMPT) {
      if (relevance instanceof Error) throw relevance
      return wrap(relevance)
    }
    return wrap(full)
  })
}

async function run(e: (typeof LABELLED_EMAILS)[number], opts: Parameters<typeof classifyEmail>[2]) {
  const stages: EmailFunnelStage[] = []
  const r = await classifyEmail(never, fetched(e), { ...opts, onStage: (s) => stages.push(s) })
  return { r, stages }
}

describe('two-step classification', () => {
  const policyEmail = named('life-renewal')
  const promo = named('newsletter-sipp-promo')

  it('a relevance "no" settles the email with one cheap call and no full classification', async () => {
    const decide = decideFor('no')
    const { r, stages } = await run(promo, {
      decide: decide as unknown as DecisionFn,
      twoStep: true,
    })
    expect(r.isFinancial).toBe(false)
    expect(r.failed).toBeUndefined()
    expect(stages).toEqual(['relevance_no'])
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide.mock.calls[0]![0].system).toBe(EMAIL_RELEVANCE_SYSTEM_PROMPT)
  })

  it('a relevance "yes" goes on to the full classification, and its answer is the result', async () => {
    const decide = decideFor('yes')
    const { r, stages } = await run(policyEmail, {
      decide: decide as unknown as DecisionFn,
      twoStep: true,
    })
    expect(r.isFinancial).toBe(true)
    expect(r.summary).toBe('Your policy renews soon.')
    expect(r.policy?.provider).toBe('BrightLife')
    expect(stages).toEqual(['model_call'])
    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide.mock.calls[1]![0].system).toBe(EMAIL_CLASSIFY_SYSTEM_PROMPT)
  })

  it('uses decideDetail for the full classification when given (its own task policy)', async () => {
    const relevance = decideFor('yes')
    const detailOnly = vi.fn(async () => wrap(detail()))
    const { r } = await run(policyEmail, {
      decide: relevance as unknown as DecisionFn,
      decideDetail: detailOnly as unknown as DecisionFn,
      twoStep: true,
    })
    expect(r.isFinancial).toBe(true)
    expect(relevance).toHaveBeenCalledTimes(1) // relevance only
    expect(detailOnly).toHaveBeenCalledTimes(1)
  })

  it('both calls send the same user message, so the framing against injection is identical', async () => {
    const decide = decideFor('yes')
    await run(policyEmail, { decide: decide as unknown as DecisionFn, twoStep: true })
    const expected = emailUserPrompt(fetched(policyEmail))
    expect(decide.mock.calls[0]![0]).toMatchObject({ prompt: expected })
    expect(decide.mock.calls[1]![0]).toMatchObject({ prompt: expected })
  })

  it('a failed relevance call is a failed classification, so the mail is retried, never dropped', async () => {
    const decide = decideFor(new Error('judge down'))
    const { r, stages } = await run(policyEmail, {
      decide: decide as unknown as DecisionFn,
      twoStep: true,
    })
    expect(r.failed).toBe(true)
    expect(r.isFinancial).toBe(false)
    expect(stages).toEqual([])
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('a failed full classification after a relevance "yes" is also a failed classification', async () => {
    const decide = vi.fn(async (req: { system: string }) => {
      if (req.system === EMAIL_RELEVANCE_SYSTEM_PROMPT) return wrap('yes')
      throw new Error('judge down')
    })
    const { r } = await run(policyEmail, { decide: decide as unknown as DecisionFn, twoStep: true })
    expect(r.failed).toBe(true)
  })

  it('if the full classification disagrees with a relevance "yes", the full classification wins', async () => {
    const decide = decideFor('yes', detail({ is_financial: false, summary: '', action_label: '' }))
    const { r } = await run(policyEmail, { decide: decide as unknown as DecisionFn, twoStep: true })
    expect(r.isFinancial).toBe(false)
    expect(r.failed).toBeUndefined()
  })

  it('without the flag it is the single full call, exactly as before', async () => {
    const decide = decideFor('no') // would settle it, if it were consulted
    const { r, stages } = await run(policyEmail, { decide: decide as unknown as DecisionFn })
    expect(r.isFinancial).toBe(true)
    expect(stages).toEqual(['model_call'])
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide.mock.calls[0]![0].system).toBe(EMAIL_CLASSIFY_SYSTEM_PROMPT)
  })

  it('the flag is ignored without a local model: the cloud path keeps its single call', async () => {
    const llm = vi.fn(async () => JSON.stringify(detail()))
    const stages: EmailFunnelStage[] = []
    const r = await classifyEmail(llm as unknown as LlmFn, fetched(policyEmail), {
      twoStep: true,
      onStage: (s) => stages.push(s),
    })
    expect(r.isFinancial).toBe(true)
    expect(llm).toHaveBeenCalledTimes(1)
    expect(stages).toEqual(['model_call'])
  })
})

describe('two-step mode keeps the free stages in front', () => {
  const decide = () => decideFor('yes')

  it('the will/LPA rule still settles its emails with no model call', async () => {
    const d = decide()
    const { r, stages } = await run(named('will-reminder'), {
      decide: d as unknown as DecisionFn,
      twoStep: true,
    })
    expect(r.isFinancial).toBe(true)
    expect(stages).toEqual(['rule_hit'])
    expect(d).not.toHaveBeenCalled()
  })

  it('the prefilter still skips mail with no policy terms with no model call', async () => {
    const d = decide()
    const { stages } = await run(named('food-order'), {
      decide: d as unknown as DecisionFn,
      twoStep: true,
      prefilter: true,
    })
    expect(stages).toEqual(['prefilter_skip'])
    expect(d).not.toHaveBeenCalled()
  })

  it('an encoder gate skip still settles it for free, and a gate pass reaches the relevance call', async () => {
    const policyEmail = named('life-renewal')
    const skip = decide()
    const a = await run(policyEmail, {
      decide: skip as unknown as DecisionFn,
      twoStep: true,
      encoder: { classify: (async () => ({ relevant: false })) as never, mode: 'gate' },
    })
    expect(a.stages).toEqual(['encoder_skip'])
    expect(skip).not.toHaveBeenCalled()

    const pass = decide()
    const b = await run(policyEmail, {
      decide: pass as unknown as DecisionFn,
      twoStep: true,
      encoder: { classify: (async () => ({ relevant: true })) as never, mode: 'gate' },
    })
    expect(b.stages).toEqual(['model_call'])
    expect(pass).toHaveBeenCalledTimes(2)
  })

  it('exactly one stage per email across the whole labelled set', async () => {
    const d = vi.fn(async (req: { system: string }) =>
      req.system === EMAIL_RELEVANCE_SYSTEM_PROMPT ? wrap('no') : wrap(detail()),
    )
    for (const e of LABELLED_EMAILS) {
      const { stages } = await run(e, {
        decide: d as unknown as DecisionFn,
        twoStep: true,
        prefilter: true,
      })
      expect(stages, e.name).toHaveLength(1)
    }
  })
})

describe('askRelevance', () => {
  it('decodes to a constrained yes/no and sends the relevance prompt', async () => {
    const decide = vi.fn(async (_req: unknown) => wrap('yes'))
    expect(
      await askRelevance(decide as unknown as DecisionFn, fetched(named('life-renewal'))),
    ).toBe('yes')
    const req = decide.mock.calls[0]![0] as {
      jsonSchema: unknown
      schema: { safeParse: (v: unknown) => { success: boolean } }
    }
    expect(req.jsonSchema).toEqual({ type: 'string', enum: ['yes', 'no'] })
    expect(req.schema.safeParse('maybe').success).toBe(false)
    expect(req.schema.safeParse('no').success).toBe(true)
  })
})
