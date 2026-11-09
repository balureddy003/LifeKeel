import { describe, it, expect } from 'vitest'
import { cellText, confirmSummary } from '../domain-copy'

const person = (id: string, name: string) => ({ id, name })
const waitingOn = (names: string[]) =>
  confirmSummary({
    required: names.map((n) => person(n.toLowerCase(), n)),
    confirmed: [],
    both_confirmed: false,
    viewer_confirmed: false,
  })

describe('confirmSummary: who is still to confirm', () => {
  it('names one or two people plainly', () => {
    expect(waitingOn(['Sam'])).toBe('Waiting for Sam to confirm they have seen this version.')
    expect(waitingOn(['Sam', 'Alex'])).toBe(
      'Waiting for Sam and Alex to confirm they have seen this version.',
    )
  })

  it('reads as a list, not "A and B and C", with three or more people', () => {
    expect(waitingOn(['Adult A', 'Partner Two', 'Partner P'])).toBe(
      'Waiting for Adult A, Partner Two and Partner P to confirm they have seen this version.',
    )
    expect(waitingOn(['A', 'B', 'C', 'D'])).toBe(
      'Waiting for A, B, C and D to confirm they have seen this version.',
    )
  })
})

describe('cellText', () => {
  it('says employer cover as a fact on file', () => {
    expect(cellText('employer')).toBe('Through their employer')
  })
})
