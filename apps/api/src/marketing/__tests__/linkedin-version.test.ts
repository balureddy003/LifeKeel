import { describe, expect, it } from 'vitest'
import {
  LINKEDIN_API_VERSION_DEFAULT,
  LINKEDIN_VERSION_FAIL_AFTER_MONTHS,
  VERSION_ERROR_PREFIX,
  isLinkedinVersionError,
  linkedinApiVersion,
  versionAgeMonths,
  versionErrorMessage,
} from '../linkedin-version.js'

describe('the pinned LinkedIn API version', () => {
  // Self-expiring: LinkedIn rejects a version a year after release. This fails at 11 months
  // so the pin is moved while posting still works, instead of discovered when it breaks.
  it(`is younger than ${LINKEDIN_VERSION_FAIL_AFTER_MONTHS} months — bump LINKEDIN_API_VERSION_DEFAULT if this fails`, () => {
    const age = versionAgeMonths(LINKEDIN_API_VERSION_DEFAULT)
    expect(
      age,
      `LinkedIn API version ${LINKEDIN_API_VERSION_DEFAULT} is ${age} months old; LinkedIn sunsets a version after 12. ` +
        'Check https://learn.microsoft.com/en-us/linkedin/marketing/versioning and update marketing/linkedin-version.ts.',
    ).toBeLessThan(LINKEDIN_VERSION_FAIL_AFTER_MONTHS)
  })

  it('is not in the future', () => {
    expect(versionAgeMonths(LINKEDIN_API_VERSION_DEFAULT)).toBeGreaterThanOrEqual(0)
  })

  it('is a six-digit YYYYMM', () => {
    expect(LINKEDIN_API_VERSION_DEFAULT).toMatch(/^20\d{2}(0[1-9]|1[0-2])$/)
  })
})

describe('versionAgeMonths', () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`)
  it('counts whole calendar months', () => {
    expect(versionAgeMonths('202610', at('2026-10-24'))).toBe(0)
    expect(versionAgeMonths('202501', at('2026-10-24'))).toBe(21)
    expect(versionAgeMonths('202511', at('2026-10-24'))).toBe(11)
    expect(versionAgeMonths('202611', at('2026-10-24'))).toBe(-1)
  })
  it('would have flagged the old 202501 pin', () => {
    expect(versionAgeMonths('202501', at('2026-01-15'))).toBeGreaterThanOrEqual(12)
    expect(versionAgeMonths('202501', at('2026-01-15'))).toBeGreaterThanOrEqual(
      LINKEDIN_VERSION_FAIL_AFTER_MONTHS,
    )
  })
})

describe('linkedinApiVersion', () => {
  it('uses the default, accepts a valid override, and ignores a malformed one', () => {
    expect(linkedinApiVersion({})).toBe(LINKEDIN_API_VERSION_DEFAULT)
    expect(linkedinApiVersion({ LINKEDIN_API_VERSION: '202705' })).toBe('202705')
    expect(linkedinApiVersion({ LINKEDIN_API_VERSION: ' 202705 ' })).toBe('202705')
    for (const bad of ['', 'latest', '2027-05', '20270', '2027055'])
      expect(linkedinApiVersion({ LINKEDIN_API_VERSION: bad }), bad).toBe(
        LINKEDIN_API_VERSION_DEFAULT,
      )
  })
})

describe('isLinkedinVersionError', () => {
  it('recognises LinkedIn rejecting a version', () => {
    expect(isLinkedinVersionError({ status: 426, message: 'x' })).toBe(true)
    expect(
      isLinkedinVersionError(
        new Error('linkedin 400: NONEXISTENT_VERSION: Requested version is not active'),
      ),
    ).toBe(true)
    expect(
      isLinkedinVersionError(new Error('Version 202501 is deprecated and no longer supported')),
    ).toBe(true)
  })
  it('does not blame the version for anything else', () => {
    expect(isLinkedinVersionError({ status: 401, message: 'Invalid access token' })).toBe(false)
    expect(isLinkedinVersionError({ status: 403, message: 'Not enough permissions' })).toBe(false)
    expect(isLinkedinVersionError({ status: 429, message: 'rate limited' })).toBe(false)
    expect(isLinkedinVersionError(new Error('network down'))).toBe(false)
    expect(isLinkedinVersionError(null)).toBe(false)
  })
  it('the message names the setting to change', () => {
    const m = versionErrorMessage('202501')
    expect(m.startsWith(VERSION_ERROR_PREFIX)).toBe(true)
    expect(m).toMatch(/202501/)
    expect(m).toMatch(/LINKEDIN_API_VERSION/)
  })
})
