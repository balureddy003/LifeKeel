import { describe, expect, it } from 'vitest'
import { anyEndsWithEmployment, composeRecordedCover, takesEmployerCover } from '../cover-form'
import type { EmployerCoverFact } from '@/lib/api'

const f = (over: Partial<EmployerCoverFact> = {}): EmployerCoverFact => ({
  id: 'ec1',
  member_label: 'Sam',
  type: 'death_in_service',
  name_as_printed: 'Acme Group Life',
  source: 'HR portal',
  last_seen_at: '2026-09-01',
  ends_with_employment: true,
  confirmed: true,
  ...over,
})

describe('composeRecordedCover', () => {
  it('composes one line per confirmed fact, naming source and end flag', () => {
    expect(composeRecordedCover([f()])).toBe(
      'Sam: Acme Group Life (HR portal, seen 2026-09-01) — may end with the employment',
    )
  })
  it('skips unconfirmed facts and optional bits', () => {
    const out = composeRecordedCover([
      f({ confirmed: false }),
      f({ source: null, last_seen_at: null, ends_with_employment: false }),
    ])
    expect(out).toBe('Sam: Acme Group Life')
  })
})

describe('anyEndsWithEmployment / takesEmployerCover', () => {
  it('flags only confirmed ends-with-employment facts', () => {
    expect(anyEndsWithEmployment([f({ confirmed: false })])).toBe(false)
    expect(anyEndsWithEmployment([f()])).toBe(true)
  })
  it('matches stop and mixed modes only', () => {
    expect(takesEmployerCover('stop')).toBe(true)
    expect(takesEmployerCover('mixed')).toBe(true)
    expect(takesEmployerCover('income')).toBe(false)
    expect(takesEmployerCover('handover')).toBe(false)
  })
})
