import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { COST_LINES } from '../CostSection'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

const after = (a: string, b: string) =>
  screen
    .getByRole('heading', { name: a })
    .compareDocumentPosition(screen.getByRole('heading', { name: b })) &
  Node.DOCUMENT_POSITION_FOLLOWING

describe('the calm cost, and the promises up front', () => {
  it('names the ordinary cost right after the hero, before the story', () => {
    render(<HomeExperience />)
    expect(after('Know where to look.', 'Most families run on one person’s memory.')).toBeTruthy()
    expect(after('Most families run on one person’s memory.', 'Marcia’s Tuesday.')).toBeTruthy()
  })

  it('keeps the cost ordinary: no disaster imagery, no fear, no advice', () => {
    const text = COST_LINES.join(' ')
    expect(text).not.toMatch(/hospital|A&E|die[ds]?\b|death|dead|accident|panic|too late/i)
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bgap\b|not covered/i)
  })

  it('shows what LifeKeel does not do before the long list of use cases', () => {
    render(<HomeExperience />)
    expect(
      after('Things that usually live in one head.', 'Six things Keel does not do.'),
    ).toBeTruthy()
    expect(
      after('Six things Keel does not do.', 'The things your family says out loud.'),
    ).toBeTruthy()
  })
})
