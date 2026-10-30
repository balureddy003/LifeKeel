import { describe, expect, it } from 'vitest'
import type { BriefCatalogueEntry } from '@/lib/api'
import {
  enteredFieldCount,
  firstNumberMeta,
  firstValueRequirements,
  formStartedMeta,
} from '../friction'

const entry = (over: Partial<BriefCatalogueEntry> = {}): BriefCatalogueEntry => ({
  id: 'earning_less',
  title: 'Someone is about to earn less',
  group: 'Money and income',
  mode: 'income',
  trigger: 'Pay change date',
  ...over,
})

/** Mirror of the API's FRICTION_META_KEYS — the two sides must not drift. */
const ALLOWED_KEYS = new Set([
  'problem_type',
  'ms_since_form_start',
  'fields_entered',
  'steps_seen',
  'needed_account',
  'needed_connection',
  'needed_upload',
])

describe('enteredFieldCount', () => {
  it('counts fields holding a value, ignoring blanks and the steps counter', () => {
    expect(enteredFieldCount({})).toBe(0)
    expect(
      enteredFieldCount({
        income: '4000',
        essentials: '',
        savings: '8000',
        change_date: '2026-12-01',
        steps_n: '2',
      }),
    ).toBe(3)
  })

  it('counts a typed zero — it is an answer, not an absence', () => {
    expect(enteredFieldCount({ savings: '0' })).toBe(1)
  })
})

describe('formStartedMeta', () => {
  it('carries only the entry id, the starting field count and the requirements', () => {
    const meta = formStartedMeta(entry(), { income: '4000' })
    expect(meta).toEqual({
      problem_type: 'earning_less',
      fields_entered: 1,
      needed_account: false,
      needed_connection: false,
      needed_upload: false,
    })
    for (const k of Object.keys(meta)) expect(ALLOWED_KEYS.has(k)).toBe(true)
  })
})

describe('firstNumberMeta', () => {
  it('reports time to the first number, fields entered and screens seen', () => {
    const meta = firstNumberMeta(
      entry(),
      { income: '4000', essentials: '2500', savings: '8000', change_date: '2026-12-01' },
      2,
      100_000,
      141_234,
    )
    expect(meta).toEqual({
      problem_type: 'earning_less',
      ms_since_form_start: 41_234,
      fields_entered: 4,
      steps_seen: 2,
      needed_account: false,
      needed_connection: false,
      needed_upload: false,
    })
    for (const k of Object.keys(meta)) expect(ALLOWED_KEYS.has(k)).toBe(true)
  })

  it('omits the timing rather than inventing one when the form was never focused', () => {
    const meta = firstNumberMeta(entry(), { income: '4000' }, 1, null, 500)
    expect(meta.ms_since_form_start).toBeUndefined()
  })

  it('never reports a negative timing', () => {
    const meta = firstNumberMeta(entry(), {}, 1, 1_000, 500)
    expect(meta.ms_since_form_start).toBe(0)
  })
})

describe('firstValueRequirements', () => {
  it('no catalogue entry needs an account, connection or upload for its first number', () => {
    for (const mode of ['stop', 'income', 'cost', 'mixed', 'cash', 'handover'] as const) {
      expect(firstValueRequirements(entry({ mode }))).toEqual({
        needed_account: false,
        needed_connection: false,
        needed_upload: false,
      })
    }
  })
})
