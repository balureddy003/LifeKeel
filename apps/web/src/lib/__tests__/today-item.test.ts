/** The "check this today" rule: dates, then stopped payments and nomination mismatches, then the missing fact. */
import { describe, expect, it } from 'vitest'
import { pickTodayItem } from '../today-item'
import type { FamilyInsight, Obligation } from '../api'

const today = '2026-10-31'
const ob = (label: string, next_due_date: string) => ({ label, next_due_date }) as Obligation
const ins = (rule_id: string, created_at: string, state = 'open'): FamilyInsight =>
  ({
    id: rule_id + created_at,
    rule_id,
    hypothesis: `H ${rule_id}`,
    reasoning: 'R',
    state,
    created_at,
  }) as FamilyInsight

const base = { obligations: [], insights: [], profileCompleteness: 100, today }

describe('pickTodayItem', () => {
  it('puts a date inside 14 days first, soonest first, even over a stopped payment', () => {
    const r = pickTodayItem({
      ...base,
      obligations: [ob('Council tax', '2026-11-10'), ob('Mortgage', '2026-11-03')],
      insights: [ins('premium_possibly_stopped', '2026-10-01')],
    })
    expect(r.tier).toBe('date')
    expect(r.tier === 'date' && r.title).toContain('Mortgage')
  })

  it('ignores dates beyond the window and counts overdue ones', () => {
    expect(pickTodayItem({ ...base, obligations: [ob('Far', '2026-11-20')] }).tier).toBe('none')
    expect(pickTodayItem({ ...base, obligations: [ob('Late', '2026-10-28')] }).tier).toBe('date')
  })

  it('then a stopped payment or nomination mismatch, newest first, open only', () => {
    const r = pickTodayItem({
      ...base,
      insights: [
        ins('premium_possibly_stopped', '2026-09-01'),
        ins('nomination_names_ex_partner', '2026-10-20'),
        ins('nomination_none_on_file', '2026-10-25', 'dismissed'),
        ins('retirement_gap', '2026-10-30'),
      ],
    })
    expect(r.tier).toBe('check')
    expect(r.tier === 'check' && r.title).toBe('H nomination_names_ex_partner')
  })

  it('then the missing profile fact, else nothing', () => {
    expect(pickTodayItem({ ...base, profileCompleteness: 60 }).tier).toBe('missing')
    expect(pickTodayItem(base).tier).toBe('none')
  })
})
