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

  describe('start tier (a household with nothing on file and no one else on it)', () => {
    const fresh = { ...base, profileCompleteness: 0, startWithOtherAdult: true }

    it('asks for the other adult, links to Add Member, and says why', () => {
      const r = pickTodayItem(fresh)
      expect(r.tier).toBe('start')
      if (r.tier !== 'start') return
      expect(r.title).toMatch(/other adult/i)
      expect(r.href).toBe('/settings?add=1')
      expect(r.why).toMatch(/^Why this one/)
    })

    it('never outranks something real: a date, a check, or a missing fact', () => {
      expect(pickTodayItem({ ...fresh, obligations: [ob('Mortgage', '2026-11-03')] }).tier).toBe(
        'date',
      )
      expect(
        pickTodayItem({ ...fresh, insights: [ins('premium_possibly_stopped', '2026-10-01')] }).tier,
      ).toBe('check')
      expect(pickTodayItem({ ...fresh, profileCompleteness: 40 }).tier).toBe('missing')
    })

    it('a household with nothing on file is first asked for one policy, which gives a result in a minute', () => {
      const r = pickTodayItem({
        ...base,
        profileCompleteness: 0,
        startWithPolicy: true,
        startWithOtherAdult: true,
      })
      expect(r.tier).toBe('start')
      if (r.tier !== 'start') return
      expect(r.title).toMatch(/one policy/i)
      expect(r.href).toBe('/policies/new')
      expect(r.why).toMatch(/^Why this one/)
      expect(r.why).toMatch(/monthly and yearly/i)
    })

    it('the policy ask never outranks something real', () => {
      expect(pickTodayItem({ ...base, startWithPolicy: true, profileCompleteness: 40 }).tier).toBe(
        'missing',
      )
    })

    it('is off unless asked for, so an account with data or a partner is untouched', () => {
      expect(pickTodayItem({ ...base, profileCompleteness: 0 }).tier).toBe('none')
    })
  })

  it('a list waiting on you comes after dates and checks, before a missing detail', () => {
    const awaitingYou = { title: 'Life and income protection', href: '/domains?d=life_protection' }
    const r = pickTodayItem({ ...base, profileCompleteness: 60, awaitingYou })
    expect(r.tier).toBe('confirm')
    expect(r.tier === 'confirm' && r.title).toBe('Look at Life and income protection and confirm')
    expect(r.tier === 'confirm' && r.href).toBe('/domains?d=life_protection')
    expect(
      pickTodayItem({ ...base, awaitingYou, obligations: [ob('Mortgage', '2026-11-03')] }).tier,
    ).toBe('date')
    expect(
      pickTodayItem({
        ...base,
        awaitingYou,
        insights: [ins('premium_possibly_stopped', '2026-10-01')],
      }).tier,
    ).toBe('check')
  })

  it('nothing awaiting you changes nothing', () => {
    expect(pickTodayItem({ ...base, awaitingYou: null }).tier).toBe('none')
  })
})
