/**
 * PRD-230 items 3 and 9: partial answers are the rule, and depth never
 * gates the front door. Every non-handover, non-sensitive catalogue entry
 * must produce a number from today's three figures and a date alone — the
 * exact minimum the friction budget allows. The catalogue is the real
 * server-side list (apps/api/src/briefs/catalogue-entries.ts): a new entry
 * that needs more than the minimum, or a connection/account/upload, fails
 * here the moment it is added.
 */
import { describe, expect, it } from 'vitest'
import { BRIEF_CATALOGUE } from '../../../../../api/src/briefs/catalogue-entries'
import { buildInputs, previewForm } from '../brief-form'
import { firstValueRequirements } from '../friction'

/** The minimum the budget allows: three money fields and one date. */
const MINIMUM = {
  income: '4000',
  essentials: '2500',
  savings: '8000',
  change_date: '2026-12-01',
}

/** Every key the solver understands (CatalogueInputsSchema). Nothing else
 *  may be sent — no account id, connection or upload rides along. */
const SOLVER_INPUT_KEYS = new Set([
  'monthly_income_minor',
  'monthly_essentials_minor',
  'liquid_savings_minor',
  'new_income_minor',
  'new_essentials_minor',
  'change_date',
  'cash_out_minor',
  'cash_in_minor',
  'return_date',
  'return_income_minor',
  'return_essentials_minor',
  'income_steps',
  'income_protection_monthly_minor',
  'deferred_period_months',
  'cover_end_date',
  'decision_deadline',
  'recorded_cover',
  'facts',
  'sensitive_consent',
])

const previewable = BRIEF_CATALOGUE.filter((e) => e.mode !== 'handover' && !e.sensitive)

describe('first value needs no connection (PRD-230)', () => {
  it('enumerates the real catalogue, not a copy', () => {
    expect(previewable.length).toBeGreaterThan(10)
    expect(BRIEF_CATALOGUE.some((e) => e.mode === 'handover')).toBe(true)
    expect(BRIEF_CATALOGUE.some((e) => e.sensitive)).toBe(true)
  })

  for (const e of previewable) {
    it(`${e.id}: answers from three money fields and a date`, () => {
      const partial = previewForm(e, MINIMUM)
      expect(partial, `${e.id} stayed silent with the minimum filled`).not.toBeNull()

      const inputs = buildInputs(e, partial!.form)
      expect(inputs.monthly_income_minor).toBe(400_000)
      expect(inputs.monthly_essentials_minor).toBe(250_000)
      expect(inputs.liquid_savings_minor).toBe(800_000)
      expect(inputs.change_date).toBe('2026-12-01')
      for (const k of Object.keys(inputs)) {
        expect(SOLVER_INPUT_KEYS.has(k), `${e.id} sent unexpected key "${k}"`).toBe(true)
      }
      expect(inputs.facts).toBeUndefined()
      expect(inputs.sensitive_consent).toBeUndefined()

      expect(firstValueRequirements(e)).toEqual({
        needed_account: false,
        needed_connection: false,
        needed_upload: false,
      })
    })
  }
})
