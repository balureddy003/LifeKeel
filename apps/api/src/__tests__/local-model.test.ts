import { afterEach, describe, expect, it } from 'vitest'
import type { LlmFn } from '@agentoak/platform'
import { BlockedLocalOutputError, familyDataLlmFromEnv, localDecisionFromEnv, ungroundedNumbers, volunteeredProviders, withOutputGuard } from '../local-model.js'

const say = (text: string): LlmFn => async () => text

describe('ungroundedNumbers', () => {
  const source = 'Salary 3,200 GBP, expenses 30,000 GBP, fund 6,000 GBP.'

  it('accepts figures that appear in the source, with or without thousands separators', () => {
    expect(ungroundedNumbers('You have 6,000 GBP and earn 3200.', source)).toEqual([])
  })

  it('flags figures the source never stated', () => {
    expect(ungroundedNumbers('Rent (800 GBP), income 2,560 GBP', source)).toEqual(['800', '2560'])
  })

  it('allows a simple sum or difference of two stated figures, such as a shortfall', () => {
    expect(ungroundedNumbers('Shortfall of 1,500 GBP', 'Fund 6,000 GBP, target 7,500 GBP')).toEqual([])
    expect(ungroundedNumbers('Combined 9,500 GBP', 'Fund 6,000 GBP, savings 3,500 GBP')).toEqual([])
  })

  it('still rejects percentage and division results, the projections the assistant must not make', () => {
    expect(ungroundedNumbers('Down 20% to 2,560 GBP, so 2,500 GBP monthly', 'Salary 3,200 GBP, expenses 30,000 GBP')).toEqual(['2560', '2500'])
  })

  it('ignores short wording numbers like "3 months" or "5 years"', () => {
    expect(ungroundedNumbers('Aim for 3 months over 5 years, up 20%', source)).toEqual([])
  })
})

describe('withOutputGuard', () => {
  it('passes grounded, informational text through unchanged', async () => {
    const llm = withOutputGuard(say('Your fund is 6,000 GBP. Please consult a licensed professional.'))
    expect(await llm('sys', 'Family data: fund 6,000 GBP', 'tier:fast')).toContain('6,000 GBP')
  })

  it('rejects provider steering and advice', async () => {
    await expect(withOutputGuard(say('The best insurer for you is Acme.'))('s', 'p')).rejects.toBeInstanceOf(BlockedLocalOutputError)
    await expect(withOutputGuard(say('You should switch to a cheaper plan.'))('s', 'p')).rejects.toBeInstanceOf(BlockedLocalOutputError)
  })

  it('lets a compliant refusal through even though it mentions "the best insurer"', async () => {
    const refusal = 'I do not have data to identify the best insurer for you. To determine the best insurer, consult a licensed professional. I cannot recommend a specific insurer or provider.'
    expect(await withOutputGuard(say(refusal))('s', 'p')).toBe(refusal)
  })

  it('still rejects affirmative steering in generated text', async () => {
    await expect(withOutputGuard(say('The best insurer for you is a mutual society.'))('s', 'p')).rejects.toBeInstanceOf(BlockedLocalOutputError)
  })

  it('rejects a well-known provider the model volunteered, but allows one the family already holds', async () => {
    await expect(withOutputGuard(say('Aviva is a good option for cover.'))('s', 'Family data: life cover 100 GBP')).rejects.toThrow(/provider_steering\(aviva\)/)
    expect(await withOutputGuard(say('Your Aviva policy renews soon.'))('s', 'Policy provider: Aviva')).toContain('Aviva')
  })

  it('rejects invented figures such as a made-up projection or budget', async () => {
    await expect(withOutputGuard(say('Your new surplus would be 640 GBP.'))('s', 'salary 3,200 GBP')).rejects.toThrow(/ungrounded_numbers\(640\)/)
  })
})

describe('volunteeredProviders', () => {
  it('matches whole names only', () => {
    expect(volunteeredProviders('The progressive tax system', 'x')).toEqual(['progressive'])
    expect(volunteeredProviders('A hastings-style plan', 'x')).toEqual(['hastings'])
    expect(volunteeredProviders('nothing here', 'x')).toEqual([])
  })
})

describe('env gating', () => {
  const keys = ['LOCAL_JUDGE_BASE_URL', 'LOCAL_TEXT_ENABLED', 'LOCAL_JUDGE_MODEL'] as const
  afterEach(() => { for (const k of keys) delete process.env[k] })

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
  })
})
