import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { AboutContent } from '../MarketingPage'
import { COST_LINES } from '../CostSection'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

const after = (a: string, b: string) =>
  screen
    .getByRole('heading', { name: a })
    .compareDocumentPosition(screen.getByRole('heading', { name: b })) &
  Node.DOCUMENT_POSITION_FOLLOWING

describe('the calm cost, and the promises up front', () => {
  it('opens /about with the ordinary cost, then the six promises', () => {
    render(<AboutContent />)
    expect(
      after('Most families run on one person’s memory.', 'Six things Keel does not do.'),
    ).toBeTruthy()
  })

  it('keeps the cost ordinary: no disaster imagery, no fear, no advice', () => {
    const text = COST_LINES.join(' ')
    expect(text).not.toMatch(/hospital|A&E|die[ds]?\b|death|dead|accident|panic|too late/i)
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bgap\b|not covered/i)
  })

  it('puts what LifeKeel does not do on the home page, before the price', () => {
    render(<HomeExperience />)
    expect(after('What Keel does not do.', 'Free to start. One optional paid plan.')).toBeTruthy()
  })
})
