/**
 * PRD-142 processor registry: a loader that refuses blanks and placeholders on
 * an approved entry, and a pure check with one clear reason per refusal.
 */
import { describe, expect, it } from 'vitest'
import {
  NOT_REVIEWED,
  ProcessorRegistryError,
  checkProcessorForTask,
  parseProcessorRegistry,
} from '../ai-processors.js'
import type { AiTaskPolicy } from '../task-gateway.js'

const hosted = (over: Record<string, unknown> = {}) => ({
  name: 'Hosted Co',
  hosting: 'hosted',
  status: 'unreviewed',
  endpoint: 'https://api.hosted.test',
  region: NOT_REVIEWED,
  terms_ref: NOT_REVIEWED,
  no_training_basis: NOT_REVIEWED,
  retention: { '*': 'limited_abuse_log' },
  sub_processors: [NOT_REVIEWED],
  transfer_mechanism: NOT_REVIEWED,
  dpa_date: NOT_REVIEWED,
  breach_notice_sla: NOT_REVIEWED,
  reviewed_at: NOT_REVIEWED,
  review_due: NOT_REVIEWED,
  ...over,
})
const approved = (over: Record<string, unknown> = {}) =>
  hosted({
    status: 'approved',
    region: 'EU (Ireland)',
    terms_ref: 'DPA v3, signed',
    no_training_basis: 'Contract clause 4.2',
    retention: { '*': 'service_transient', 'tier:fast': 'zero_data_retention' },
    sub_processors: ['Cloud Host Ltd'],
    transfer_mechanism: 'UK IDTA',
    dpa_date: '2026-09-01',
    breach_notice_sla: '48 hours',
    reviewed_at: '2026-10-01',
    review_due: '2027-10-01',
    ...over,
  })
const selfHosted = () =>
  hosted({
    hosting: 'self_hosted',
    status: 'self_hosted',
    retention: { '*': 'none' },
    sub_processors: ['none'],
  })
const load = (processors: Record<string, unknown>) => parseProcessorRegistry({ processors })

describe('parseProcessorRegistry', () => {
  it('loads unreviewed, approved and self-hosted entries', () => {
    const r = load({ a: hosted(), b: approved(), c: selfHosted() })
    expect([...r.keys()]).toEqual(['a', 'b', 'c'])
    expect(r.get('a')!.id).toBe('a')
  })

  it.each([
    'name',
    'endpoint',
    'region',
    'terms_ref',
    'no_training_basis',
    'transfer_mechanism',
    'dpa_date',
    'breach_notice_sla',
    'reviewed_at',
    'review_due',
  ])('refuses a blank %s', (field) => {
    expect(() => load({ a: hosted({ [field]: '' }) })).toThrow(new RegExp(`blank '${field}'`))
    expect(() => load({ a: hosted({ [field]: '   ' }) })).toThrow(ProcessorRegistryError)
    const missing = hosted()
    delete (missing as Record<string, unknown>)[field]
    expect(() => load({ a: missing })).toThrow(ProcessorRegistryError)
  })

  it('refuses a missing sub-processor list, an empty one on a hosted entry, and bad retention', () => {
    expect(() => load({ a: hosted({ sub_processors: undefined }) })).toThrow(/sub_processors/)
    expect(() => load({ a: hosted({ sub_processors: [] }) })).toThrow(/empty sub_processors/)
    expect(() => load({ a: hosted({ retention: {} }) })).toThrow(/retention class per model/)
    expect(() => load({ a: hosted({ retention: { '*': 'forever' } }) })).toThrow(/retention class/)
  })

  it('refuses a mismatched hosting and status, and an unknown status', () => {
    expect(() => load({ a: hosted({ status: 'self_hosted' }) })).toThrow(/self_hosted/)
    expect(() => load({ a: selfHosted(), b: hosted({ status: 'maybe' }) })).toThrow(
      /invalid status/,
    )
    expect(() => load({ a: { ...selfHosted(), status: 'unreviewed' } })).toThrow(/self_hosted/)
  })

  it('refuses to approve an entry that still carries a placeholder or a non-date', () => {
    expect(() => load({ a: approved({ region: NOT_REVIEWED }) })).toThrow(/region/)
    expect(() => load({ a: approved({ sub_processors: [NOT_REVIEWED] }) })).toThrow(
      /sub-processors/,
    )
    expect(() => load({ a: approved({ dpa_date: 'September' }) })).toThrow(/YYYY-MM-DD/)
    expect(() => load({ a: approved({ review_due: '2027-13-45' }) })).toThrow(/YYYY-MM-DD/)
  })

  it('refuses a document with no processors', () => {
    expect(() => parseProcessorRegistry({})).toThrow(ProcessorRegistryError)
    expect(() => load({})).toThrow(/no processors/)
  })
})

describe('checkProcessorForTask', () => {
  const task = (over: Partial<AiTaskPolicy> = {}): AiTaskPolicy => ({
    task_id: 't.v1',
    data_boundary: 'approved_hosted_provider',
    allowed_models: ['tier:fast'],
    primary_model: 'tier:fast',
    deadline_ms: 1,
    max_input_tokens: 1,
    max_output_tokens: 1,
    provider_retention_class: 'service_transient',
    allowed_processors: ['ok', 'zdr', 'self', 'lapsed', 'unrev', 'abuse'],
    ...over,
  })
  const NOW = new Date('2026-10-20T00:00:00Z')
  const reg = load({
    ok: approved(),
    zdr: approved({ retention: { '*': 'zero_data_retention' } }),
    abuse: approved({ retention: { '*': 'limited_abuse_log' } }),
    lapsed: approved({ review_due: '2026-10-01' }),
    unrev: hosted(),
    self: selfHosted(),
    unlisted: approved(),
  })
  const check = (p: string, t = task(), model = 'tier:fast') =>
    checkProcessorForTask(reg, t, p, model, NOW)

  it('allows an approved processor within its review, and a self-hosted one', () => {
    expect(check('ok')).toBeNull()
    expect(check('self')).toBeNull()
  })

  it('names one reason per refusal', () => {
    expect(check('nope')!.reason).toBe('processor_unknown')
    expect(check('unlisted')!.reason).toBe('processor_not_allowed_for_task')
    expect(check('unrev')!.reason).toBe('processor_unreviewed')
    expect(check('lapsed')!.reason).toBe('review_lapsed')
    expect(check('abuse')!.reason).toBe('retention_exceeds_task')
  })

  it('a review due today or later is still valid, the day after is not', () => {
    const r = load({ p: approved({ review_due: '2026-10-20' }) })
    const t = task({ allowed_processors: ['p'] })
    expect(
      checkProcessorForTask(r, t, 'p', 'tier:fast', new Date('2026-10-20T00:00:00Z')),
    ).toBeNull()
    expect(
      checkProcessorForTask(r, t, 'p', 'tier:fast', new Date('2026-10-21T00:00:00Z'))!.reason,
    ).toBe('review_lapsed')
  })

  it('retention is judged per model, falling back to the wildcard', () => {
    const none = task({ provider_retention_class: 'none' })
    expect(check('ok', none, 'tier:fast')).toBeNull() // zero_data_retention for this model
    expect(check('ok', none, 'tier:balanced')!.reason).toBe('retention_exceeds_task') // wildcard service_transient
    expect(check('zdr', none)).toBeNull() // contractual zero retention satisfies "none"
  })

  it('a task with no allow-list is not restricted by it, but an empty one allows nothing', () => {
    expect(check('unlisted', (({ allowed_processors: _drop, ...rest }) => rest)(task()))).toBeNull()
    expect(check('ok', task({ allowed_processors: [] }))!.reason).toBe(
      'processor_not_allowed_for_task',
    )
  })

  it('every violation carries the task, processor and a plain detail', () => {
    expect(check('unrev')).toMatchObject({
      task_id: 't.v1',
      processor: 'unrev',
      detail: expect.stringContaining('unrev'),
    })
  })
})
