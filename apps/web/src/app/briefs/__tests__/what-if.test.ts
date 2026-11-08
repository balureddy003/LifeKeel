import { describe, expect, it } from 'vitest'
import { applyWhatIf, countdownText, daysUntil, hasChanged, whatIfSliders } from '../what-if'

const inputs = {
  monthly_income_minor: 500_000,
  monthly_essentials_minor: 300_000,
  liquid_savings_minor: 900_000,
  new_income_minor: 200_000,
  new_essentials_minor: 300_000,
  change_date: '2026-11-28',
}

describe('whatIfSliders', () => {
  it('offers the after-change figures and savings, not the current ones', () => {
    const keys = whatIfSliders(inputs).map((s) => s.key)
    expect(keys).toEqual(['new_income_minor', 'new_essentials_minor', 'liquid_savings_minor'])
  })

  it('ranges from half to one and a half times the entered figure', () => {
    const s = whatIfSliders(inputs).find((x) => x.key === 'new_income_minor')!
    expect(s.base).toBe(200_000)
    expect(s.min).toBe(100_000)
    expect(s.max).toBe(300_000)
  })

  it('lets income after the change move from zero up to the current income', () => {
    const s = whatIfSliders({ ...inputs, new_income_minor: 0 }).find(
      (x) => x.key === 'new_income_minor',
    )!
    expect([s.min, s.max]).toEqual([0, 500_000])
  })

  it('falls back to current spending when there is no after-change spending', () => {
    const { new_essentials_minor: _drop, ...rest } = inputs
    expect(whatIfSliders(rest).map((s) => s.key)).toContain('monthly_essentials_minor')
  })

  it('drops a slider that has nothing to scale from', () => {
    const zero = { ...inputs, liquid_savings_minor: 0 }
    expect(whatIfSliders(zero).map((s) => s.key)).not.toContain('liquid_savings_minor')
  })

  it('uses wider steps for large ranges', () => {
    const big = whatIfSliders({ ...inputs, liquid_savings_minor: 5_000_000 })
    expect(big.find((s) => s.key === 'liquid_savings_minor')!.step).toBe(5_000)
  })
})

describe('applyWhatIf and hasChanged', () => {
  it('overrides only the moved figures and leaves the original untouched', () => {
    const next = applyWhatIf(inputs, { new_income_minor: 250_000 })
    expect(next.new_income_minor).toBe(250_000)
    expect(next.monthly_income_minor).toBe(500_000)
    expect(inputs.new_income_minor).toBe(200_000)
  })

  it('reports a change only when a slider moved off its entered value', () => {
    const sliders = whatIfSliders(inputs)
    expect(hasChanged(sliders, { new_income_minor: 200_000 })).toBe(false)
    expect(hasChanged(sliders, { new_income_minor: 210_000 })).toBe(true)
    expect(hasChanged(sliders, {})).toBe(false)
  })
})

describe('countdown', () => {
  it('counts whole days either side of the date', () => {
    expect(daysUntil('2026-11-28', '2026-10-29')).toBe(30)
    expect(daysUntil('2026-10-29', '2026-10-29')).toBe(0)
    expect(daysUntil('2026-10-20', '2026-10-29')).toBe(-9)
  })

  it('reads naturally', () => {
    expect(countdownText(30)).toBe('starts in 30 days')
    expect(countdownText(1)).toBe('starts tomorrow')
    expect(countdownText(0)).toBe('starts today')
    expect(countdownText(-1)).toBe('started yesterday')
    expect(countdownText(-9)).toBe('started 9 days ago')
  })
})

describe('biggest lever', () => {
  it('picks the figure whose 10% move changes the runway most', async () => {
    const { biggestLever } = await import('../what-if')
    expect(
      biggestLever(6, [
        { key: 'new_income_minor', runway: 6.5 },
        { key: 'new_essentials_minor', runway: 8 },
        { key: 'liquid_savings_minor', runway: 6.6 },
      ]),
    ).toBe('new_essentials_minor')
  })
  it('returns nothing when no move changes the answer', async () => {
    const { biggestLever } = await import('../what-if')
    expect(biggestLever(6, [{ key: 'liquid_savings_minor', runway: 6 }])).toBeUndefined()
  })
  it('nudges on the helpful side and stays inside the slider', async () => {
    const { leverNudge } = await import('../what-if')
    const s = {
      key: 'new_essentials_minor',
      label: '',
      base: 200000,
      min: 100000,
      max: 300000,
      step: 1000,
    } as const
    expect(leverNudge(s)).toBe(180000)
    expect(leverNudge({ ...s, key: 'liquid_savings_minor' })).toBe(220000)
  })
})
