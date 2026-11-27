/** The waiting-period gap (innovation scan, idea 3): drawn and stated only when the solver sends one. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RunwayChart, waitingGapOf } from '../RunwayChart'

const timeline = [
  { atMonth: 1, monthlyIncomeMinor: 0, monthlyExpensesMinor: 300000, savingsMinor: 1100000 },
  { atMonth: 7, monthlyIncomeMinor: 300000, monthlyExpensesMinor: 300000, savingsMinor: 0 },
]
const withGap = {
  currentMonthlyIncomeMinor: 500000,
  currentMonthlySurplusMinor: 200000,
  timeline,
  coverStartsAtMonth: 7,
  waitingGap: {
    months: 2.3,
    runsOutMonth: 4.7,
    coverStartsMonth: 7,
    runsOut: 'March 2027',
    coverStarts: 'June 2027',
  },
}

afterEach(cleanup)

describe('waiting-period gap on the runway chart', () => {
  it('shades the gap, marks when cover starts, and says it in words with a licensed-professional pointer', () => {
    render(<RunwayChart result={withGap} startSavings={900000} />)
    expect(screen.getByTestId('waiting-gap')).toBeTruthy()
    expect(screen.getByTestId('cover-starts').textContent).toContain('Cover starts')
    const note = screen.getByTestId('waiting-gap-note').textContent ?? ''
    expect(note).toMatch(/about 2\.3 months before the cover payment starts/)
    expect(note).toMatch(/March 2027 until around June 2027/)
    expect(note).toMatch(/licensed professional/)
  })

  it('marks the cover start but shows no gap when cover starts before savings run out', () => {
    const { waitingGap: _g, ...noGap } = withGap
    render(<RunwayChart result={noGap} startSavings={900000} />)
    expect(screen.getByTestId('cover-starts')).toBeTruthy()
    expect(screen.queryByTestId('waiting-gap')).toBeNull()
    expect(screen.queryByTestId('waiting-gap-note')).toBeNull()
  })

  it('ignores a malformed gap rather than drawing guesses', () => {
    expect(waitingGapOf({ waitingGap: { months: '2' } })).toBeNull()
    expect(waitingGapOf(null)).toBeNull()
  })
})
