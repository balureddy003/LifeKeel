import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmFn } from '@lifekeel/platform'
import {
  BlockedLocalOutputError,
  CLASSIFIER_MAX_TOKENS,
  familyDataLlmFromEnv,
  localDecisionFromEnv,
  ungroundedNumbers,
  volunteeredProviders,
  withOutputGuard,
} from '../local-model.js'

const say =
  (text: string): LlmFn =>
  async () =>
    text

describe('ungroundedNumbers', () => {
  const source = 'Salary 3,200 GBP, expenses 30,000 GBP, fund 6,000 GBP.'

  it('accepts figures that appear in the source, with or without thousands separators', () => {
    expect(ungroundedNumbers('You have 6,000 GBP and earn 3200.', source)).toEqual([])
  })

  it('flags figures the source never stated', () => {
    expect(ungroundedNumbers('Rent (800 GBP), income 2,560 GBP', source)).toEqual(['800', '2560'])
  })

  it('allows a simple sum or difference of two stated figures, such as a shortfall', () => {
    expect(ungroundedNumbers('Shortfall of 1,500 GBP', 'Fund 6,000 GBP, target 7,500 GBP')).toEqual(
      [],
    )
    expect(ungroundedNumbers('Combined 9,500 GBP', 'Fund 6,000 GBP, savings 3,500 GBP')).toEqual([])
  })

  it('still rejects percentage and division results, the projections the assistant must not make', () => {
    expect(
      ungroundedNumbers(
        'Down 20% to 2,560 GBP, so 2,500 GBP monthly',
        'Salary 3,200 GBP, expenses 30,000 GBP',
      ),
    ).toEqual(['2560', '2500'])
  })

  it('does not drop later figures from a large prompt', () => {
    const many = Array.from({ length: 120 }, (_, i) => `item${i} ${1000 + i * 7}`).join(', ')
    expect(ungroundedNumbers('Item total 1833 GBP', many)).toEqual([])
  })

  it('treats a bare calendar year as wording, not a claim', () => {
    expect(ungroundedNumbers('Renews in 2027', 'Salary 3,200 GBP')).toEqual([])
  })

  it('ignores short wording numbers like "3 months" or "5 years"', () => {
    expect(ungroundedNumbers('Aim for 3 months over 5 years, up 20%', source)).toEqual([])
  })
})

describe('withOutputGuard', () => {
  it('passes grounded, informational text through unchanged', async () => {
    const llm = withOutputGuard(
      say('Your fund is 6,000 GBP. Please consult a licensed professional.'),
    )
    expect(await llm('sys', 'Family data: fund 6,000 GBP', 'tier:fast')).toContain('6,000 GBP')
  })

  it('rejects provider steering and advice', async () => {
    await expect(
      withOutputGuard(say('The best insurer for you is Acme.'))('s', 'p'),
    ).rejects.toBeInstanceOf(BlockedLocalOutputError)
    await expect(
      withOutputGuard(say('You should switch to a cheaper plan.'))('s', 'p'),
    ).rejects.toBeInstanceOf(BlockedLocalOutputError)
  })

  it('lets a compliant refusal through even though it mentions "the best insurer"', async () => {
    const refusal =
      'I do not have data to identify the best insurer for you. To determine the best insurer, consult a licensed professional. I cannot recommend a specific insurer or provider.'
    expect(await withOutputGuard(say(refusal))('s', 'p')).toBe(refusal)
  })

  it.each([
    'The best insurer for you is a mutual society.',
    'I recommend the cheapest policy you can find.',
    'You should go with the best fund available.',
    'The cheapest plan available is the right one for you.',
  ])('still rejects affirmative steering in generated text: %s', async (text) => {
    await expect(withOutputGuard(say(text))('s', 'p')).rejects.toBeInstanceOf(
      BlockedLocalOutputError,
    )
  })

  it('rejects a well-known provider the model volunteered, but allows one the family already holds', async () => {
    await expect(
      withOutputGuard(say('Aviva is a good option for cover.'))(
        's',
        'Family data: life cover 100 GBP',
      ),
    ).rejects.toThrow(/provider_steering\(aviva\)/)
    expect(
      await withOutputGuard(say('Your Aviva policy renews soon.'))('s', 'Policy provider: Aviva'),
    ).toContain('Aviva')
  })

  it('rejects invented figures such as a made-up projection or budget', async () => {
    await expect(
      withOutputGuard(say('Your new surplus would be 640 GBP.'))('s', 'salary 3,200 GBP'),
    ).rejects.toThrow(/ungrounded_numbers\(640\)/)
  })
})

describe('volunteeredProviders', () => {
  it('matches whole names only and ignores ordinary words that happen to be brands', () => {
    expect(volunteeredProviders('Consider Aviva or Direct Line', 'x')).toEqual([
      'aviva',
      'direct line',
    ])
    expect(
      volunteeredProviders('The progressive tax system, admiral rank, vitality and fidelity', 'x'),
    ).toEqual([])
    expect(volunteeredProviders('A bupafoo plan', 'x')).toEqual([])
    expect(volunteeredProviders('nothing here', 'x')).toEqual([])
  })

  it('allows a name the prompt itself supplied', () => {
    expect(volunteeredProviders('Your Aviva policy', 'Provider: Aviva')).toEqual([])
  })
})

describe('env gating', () => {
  const keys = ['LOCAL_JUDGE_BASE_URL', 'LOCAL_TEXT_ENABLED', 'LOCAL_JUDGE_MODEL'] as const
  afterEach(() => {
    for (const k of keys) delete process.env[k]
  })

  it('has no local decision model unless a base URL is configured', () => {
    expect(localDecisionFromEnv('judge')).toBeUndefined()
    expect(localDecisionFromEnv('ocr')).toBeUndefined()
  })

  it('creates local decision models for background tasks as soon as a base URL is set', () => {
    process.env['LOCAL_JUDGE_BASE_URL'] = 'http://local-judge:11434'
    expect(localDecisionFromEnv('judge')).toBeTypeOf('function')
    expect(localDecisionFromEnv('classifier')).toBeTypeOf('function')
    expect(localDecisionFromEnv('ocr')).toBeTypeOf('function')
  })

  it('keeps interactive text on the cloud router unless explicitly opted in', async () => {
    process.env['LOCAL_JUDGE_BASE_URL'] = 'http://127.0.0.1:1'
    const cloud = familyDataLlmFromEnv()
    process.env['LOCAL_TEXT_ENABLED'] = 'true'
    const local = familyDataLlmFromEnv()
    // Different functions; the local one targets the unreachable URL and fails fast, never reaching a cloud provider.
    expect(local).not.toBe(cloud)
    await expect(local('s', 'p', 'tier:fast')).rejects.toBeDefined()
  }, 30_000)
})

describe('classifier output cap', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env['LOCAL_JUDGE_BASE_URL']
  })

  const sentCap = async (purpose: 'judge' | 'classifier' | 'ocr') => {
    process.env['LOCAL_JUDGE_BASE_URL'] = 'http://judge:11434'
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ message: { content: '{"ok":true}' } })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const decide = localDecisionFromEnv(purpose)!
    const { z } = await import('zod')
    await decide({
      system: 's',
      prompt: 'p',
      schema: z.object({ ok: z.boolean() }),
      jsonSchema: { type: 'object' },
    })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    return JSON.parse(init.body as string).options.num_predict as number
  }

  it('caps the email classifier at CLASSIFIER_MAX_TOKENS, below the 256-token default', async () => {
    expect(CLASSIFIER_MAX_TOKENS).toBeLessThan(256)
    expect(await sentCap('classifier')).toBe(CLASSIFIER_MAX_TOKENS)
  })

  it('leaves the judge and OCR extraction on the default cap', async () => {
    expect(await sentCap('judge')).toBe(256)
    expect(await sentCap('ocr')).toBe(256)
  })
})
