import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { RunwayChart } from '../RunwayChart'

const result = {
  currentMonthlyIncomeMinor: 420000,
  currentMonthlySurplusMinor: 60000,
  timeline: [
    { atMonth: 3, monthlyIncomeMinor: 0, monthlyExpensesMinor: 360000, savingsMinor: 1080000 },
  ],
}

afterEach(cleanup)

describe('RunwayChart labels', () => {
  it('names the top figure instead of leaving a bare amount, and keeps it clear of "Today"', () => {
    const { container } = render(<RunwayChart result={result} startSavings={900000} />)
    const texts = [...container.querySelectorAll('text')]
    const label = texts.find((t) => /£/.test(t.textContent ?? ''))
    expect(label?.textContent).toMatch(/^(Savings today|Up to) £/)
    const today = texts.find((t) => t.textContent === 'Today')
    expect(Number(label?.getAttribute('y'))).toBeLessThan(Number(today?.getAttribute('y')) - 40)
  })
})
