import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmFn } from '@agentoak/platform'
import { classifyEmail, type EncoderOutcome } from '../email/classify.js'
import { createEncoderClassifier, EncoderError, type EncoderVerdict } from '../email/encoder-classifier.js'
import { emailEncoderFromEnv } from '../local-model.js'
import { renderMetrics, recordEmailEncoderOutcome } from '../routes/metrics.js'
import type { FetchedEmail } from '../email/imap-client.js'

const email: FetchedEmail = {
  uid: 1, messageId: 'm1', from: 'renewals@insurer.example', subject: 'Your policy renews',
  date: new Date('2026-01-01'), textSnippet: 'Your policy renews on 2027-03-01.', attachments: [],
}
const verdict = (relevant: boolean): EncoderVerdict => ({ relevant, label: relevant ? 'policy' : 'promo', confidence: 0.9, latency_ms: 400 })
const llmSaysFinancial: LlmFn = async () => JSON.stringify({ is_financial: true, summary: 'Renewal', action_label: 'Review', action_type: 'renew', priority: 'high' })
const llmSaysNot: LlmFn = async () => JSON.stringify({ is_financial: false, summary: '', action_label: '', action_type: 'info', priority: 'low' })
const tick = () => new Promise(r => setTimeout(r, 10))

describe('createEncoderClassifier', () => {
  const ok = { relevant: true, label: 'policy', confidence: 0.8, latency_ms: 300 }
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('posts the email to the single fixed endpoint and returns a validated verdict', async () => {
    const fetchImpl = vi.fn(async () => reply(ok))
    const v = await createEncoderClassifier({ baseUrl: 'http://enc:8080/', fetchImpl })(email)
    expect(v).toEqual(ok)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://enc:8080/v1/policy-relevance')
    expect(JSON.parse(init.body as string)).toEqual({ from: email.from, subject: email.subject, text: email.textSnippet })
  })

  it('attaches resolved auth headers and never sends if the header provider fails', async () => {
    const fetchImpl = vi.fn(async () => reply(ok))
    await createEncoderClassifier({ baseUrl: 'http://enc', fetchImpl, getHeaders: async () => ({ Authorization: 'Bearer t' }) })(email)
    expect(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['Authorization']).toBe('Bearer t')

    const failing = vi.fn(async () => reply(ok))
    await expect(createEncoderClassifier({ baseUrl: 'http://enc', fetchImpl: failing, getHeaders: async () => { throw new Error('no token') } })(email)).rejects.toThrow('no token')
    expect(failing).not.toHaveBeenCalled()
  })

  it('rejects HTTP errors and malformed responses instead of guessing', async () => {
    await expect(createEncoderClassifier({ baseUrl: 'http://enc', fetchImpl: vi.fn(async () => reply({}, 503)) })(email)).rejects.toBeInstanceOf(EncoderError)
    await expect(createEncoderClassifier({ baseUrl: 'http://enc', fetchImpl: vi.fn(async () => reply({ relevant: 'yes' })) })(email)).rejects.toThrow(/unexpected response/)
    await expect(createEncoderClassifier({ baseUrl: 'http://enc', fetchImpl: vi.fn(async () => reply({ ...ok, confidence: 7 })) })(email)).rejects.toBeInstanceOf(EncoderError)
  })

  it('reports each call outcome to the metrics hook, even when the hook throws', async () => {
    const events: Array<{ ok: boolean }> = []
    const good = createEncoderClassifier({ baseUrl: 'http://enc', fetchImpl: vi.fn(async () => reply(ok)), onCall: e => { events.push(e); throw new Error('metrics down') } })
    await expect(good(email)).resolves.toBeDefined()
    const bad = createEncoderClassifier({ baseUrl: 'http://enc', fetchImpl: vi.fn(async () => reply({}, 500)), onCall: e => events.push(e) })
    await expect(bad(email)).rejects.toBeDefined()
    expect(events.map(e => e.ok)).toEqual([true, false])
  })

  it('rejects a non-http base URL up front', () => {
    expect(() => createEncoderClassifier({ baseUrl: 'enc:8080' })).toThrow(EncoderError)
  })
})

describe('classifyEmail with an encoder in gate mode', () => {
  it('skips the LLM entirely when the encoder says the email is irrelevant', async () => {
    const llm = vi.fn(llmSaysFinancial)
    const outcomes: EncoderOutcome[] = []
    const result = await classifyEmail(llm, email, { encoder: { mode: 'gate', classify: async () => verdict(false), onOutcome: o => outcomes.push(o) } })
    expect(result).toMatchObject({ isFinancial: false })
    expect(result.failed).toBeUndefined() // a verdict, not a failure: the scan must not retry it
    expect(llm).not.toHaveBeenCalled()
    expect(outcomes).toEqual(['gated_skip'])
  })

  it('still runs the LLM for emails the encoder flags, since only the LLM extracts details', async () => {
    const llm = vi.fn(llmSaysFinancial)
    const outcomes: EncoderOutcome[] = []
    const result = await classifyEmail(llm, email, { encoder: { mode: 'gate', classify: async () => verdict(true), onOutcome: o => outcomes.push(o) } })
    expect(result).toMatchObject({ isFinancial: true, summary: 'Renewal' })
    expect(llm).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual(['gated_pass'])
  })

  it('fails open: an encoder outage runs the LLM instead of dropping the email', async () => {
    const llm = vi.fn(llmSaysFinancial)
    const outcomes: EncoderOutcome[] = []
    const result = await classifyEmail(llm, email, { encoder: { mode: 'gate', classify: async () => { throw new Error('down') }, onOutcome: o => outcomes.push(o) } })
    expect(result.isFinancial).toBe(true)
    expect(llm).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual(['error_fell_back'])
  })

  it('does not let a throwing metrics hook change the result', async () => {
    const result = await classifyEmail(llmSaysFinancial, email, { encoder: { mode: 'gate', classify: async () => verdict(false), onOutcome: () => { throw new Error('x') } } })
    expect(result.isFinancial).toBe(false)
  })

  it('applies the cheap prefilter first, so the encoder is not called for mail with no policy terms', async () => {
    const classify = vi.fn(async () => verdict(true))
    await classifyEmail(llmSaysFinancial, { ...email, from: 'orders@shop.example', subject: 'Order shipped', textSnippet: 'Your parcel is on its way.' }, { prefilter: true, encoder: { mode: 'gate', classify } })
    expect(classify).not.toHaveBeenCalled()
  })
})

describe('classifyEmail with an encoder in shadow mode', () => {
  it('returns the LLM result untouched whatever the encoder says, and records agreement', async () => {
    const outcomes: EncoderOutcome[] = []
    const result = await classifyEmail(llmSaysFinancial, email, { encoder: { mode: 'shadow', classify: async () => verdict(false), onOutcome: o => outcomes.push(o) } })
    expect(result.isFinancial).toBe(true) // the LLM decides in shadow mode
    await tick()
    expect(outcomes).toEqual(['encoder_missed']) // the dangerous direction is named, not merged into "disagree"
  })

  it.each([
    [true, llmSaysFinancial, 'agree'],
    [false, llmSaysNot, 'agree'],
    [true, llmSaysNot, 'encoder_extra'],
  ] as const)('encoder relevant=%s vs LLM -> %s', async (relevant, llm, expected) => {
    const outcomes: EncoderOutcome[] = []
    await classifyEmail(llm, email, { encoder: { mode: 'shadow', classify: async () => verdict(relevant), onOutcome: o => outcomes.push(o) } })
    await tick()
    expect(outcomes).toEqual([expected])
  })

  it('never delays or fails the classification: a slow or failing encoder is only recorded', async () => {
    const outcomes: EncoderOutcome[] = []
    const slow = () => new Promise<EncoderVerdict>(r => setTimeout(() => r(verdict(true)), 200))
    const started = Date.now()
    await classifyEmail(llmSaysFinancial, email, { encoder: { mode: 'shadow', classify: slow, onOutcome: o => outcomes.push(o) } })
    expect(Date.now() - started).toBeLessThan(100)

    await classifyEmail(llmSaysFinancial, email, { encoder: { mode: 'shadow', classify: async () => { throw new Error('down') }, onOutcome: o => outcomes.push(o) } })
    await tick()
    expect(outcomes).toContain('shadow_error')
  })

  it('does not compare when the LLM itself failed (nothing to compare against)', async () => {
    const outcomes: EncoderOutcome[] = []
    const result = await classifyEmail(async () => { throw new Error('llm down') }, email, { encoder: { mode: 'shadow', classify: async () => verdict(true), onOutcome: o => outcomes.push(o) } })
    expect(result.failed).toBe(true)
    await tick()
    expect(outcomes).toEqual([])
  })
})

describe('emailEncoderFromEnv and metrics', () => {
  const keys = ['EMAIL_ENCODER_URL', 'EMAIL_ENCODER_MODE'] as const
  afterEach(() => { for (const k of keys) delete process.env[k] })

  it('is off unless both a URL and an explicit shadow/gate mode are set', () => {
    expect(emailEncoderFromEnv()).toBeUndefined()
    process.env['EMAIL_ENCODER_URL'] = 'http://enc:8080'
    expect(emailEncoderFromEnv()).toBeUndefined()
    process.env['EMAIL_ENCODER_MODE'] = 'off'
    expect(emailEncoderFromEnv()).toBeUndefined()
    process.env['EMAIL_ENCODER_MODE'] = 'gate'
    expect(emailEncoderFromEnv()?.mode).toBe('gate')
    process.env['EMAIL_ENCODER_MODE'] = 'shadow'
    expect(emailEncoderFromEnv()?.mode).toBe('shadow')
  })

  it('exposes outcome counters with the outcome as the only label', async () => {
    recordEmailEncoderOutcome('encoder_missed')
    recordEmailEncoderOutcome('gated_skip')
    const text = await renderMetrics()
    expect(text).toMatch(/agentoak_email_encoder_total\{outcome="encoder_missed"\} \d+/)
    expect(text).toMatch(/agentoak_email_encoder_total\{outcome="gated_skip"\} \d+/)
  })
})
