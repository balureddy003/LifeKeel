import { describe, expect, it } from 'vitest'
import { signupDestination } from '../signup-destination'

describe('signupDestination', () => {
  it('lands on the briefs page by default, not the family-setup quiz', () => {
    expect(signupDestination(null, null)).toBe('/briefs')
  })
  it('opens the question picked on the landing page', () => {
    expect(signupDestination('income_stops', null)).toBe('/briefs?start=income_stops')
  })
  it('ignores anything that is not a plain brief id', () => {
    expect(signupDestination('//evil.example', null)).toBe('/briefs')
    expect(signupDestination('a&next=/x', null)).toBe('/briefs')
    expect(signupDestination('X'.repeat(80), null)).toBe('/briefs')
  })
  it('keeps an explicit same-site next over the brief', () => {
    expect(signupDestination('income_stops', '/b/abc')).toBe('/b/abc')
  })
})
