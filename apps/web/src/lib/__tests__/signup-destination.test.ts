import { describe, expect, it } from 'vitest'
import {
  firstStepWaitMessage,
  isFirstStepPath,
  signupDestination,
  signupProblem,
} from '../signup-destination'

describe('signupDestination', () => {
  it('lands on the family list by default: the page promises "Start your family\u2019s list"', () => {
    expect(signupDestination(null, null)).toBe('/domains')
  })
  it('opens the question picked on the landing page', () => {
    expect(signupDestination('income_stops', null)).toBe('/briefs?start=income_stops')
  })
  it('ignores anything that is not a plain brief id', () => {
    expect(signupDestination('//evil.example', null)).toBe('/domains')
    expect(signupDestination('a&next=/x', null)).toBe('/domains')
    expect(signupDestination('X'.repeat(80), null)).toBe('/domains')
  })
  it('keeps an explicit same-site next over the brief', () => {
    expect(signupDestination('income_stops', '/b/abc')).toBe('/b/abc')
  })
})

describe('signupProblem', () => {
  it('names the problem picked on the landing page', () => {
    expect(signupProblem('mortgage_fix')).toBe('Our mortgage fix is ending')
  })
  it('names nothing for an unknown or unsafe id', () => {
    expect(signupProblem('nope')).toBeNull()
    expect(signupProblem('//evil')).toBeNull()
    expect(signupProblem(null)).toBeNull()
  })
})

describe('isFirstStepPath', () => {
  it('is where a brand-new account may land and have its household created quietly', () => {
    expect(isFirstStepPath('/domains')).toBe(true)
    expect(isFirstStepPath('/domains/')).toBe(true)
    expect(isFirstStepPath('/briefs')).toBe(true)
    expect(isFirstStepPath('/briefs/abc')).toBe(true)
  })
  it('is not any other page', () => {
    for (const p of ['/', '/settings', '/login', '/signup', '/family-setup', '/b/xyz'])
      expect(isFirstStepPath(p), p).toBe(false)
  })
})

describe('firstStepWaitMessage', () => {
  it('says what is being got ready, in the words of the page being opened', () => {
    expect(firstStepWaitMessage('/domains')).toBe('Getting your family list ready…')
    expect(firstStepWaitMessage('/briefs')).toBe('Getting your question ready…')
  })
})
