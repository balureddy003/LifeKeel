import { describe, it, expect, afterEach } from 'vitest'
import { evaluateOtpBoot, generateOtpCode } from '../otp.js'

const FIXED = '424242'
const saved: Record<string, string | undefined> = {}

afterEach(() => {
  for (const k of ['LIFEKEEL_TEST_OTP_CODE', 'NODE_ENV']) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
    delete saved[k]
  }
})

function setEnv(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe('generateOtpCode', () => {
  it('honours LIFEKEEL_TEST_OTP_CODE in dev/test (QA/e2e deterministic path)', () => {
    setEnv('NODE_ENV', 'test')
    setEnv('LIFEKEEL_TEST_OTP_CODE', FIXED)
    expect(generateOtpCode()).toBe(FIXED)
  })

  it('ignores the fixed code outside dev/test — production always gets randomness', () => {
    setEnv('NODE_ENV', 'production')
    setEnv('LIFEKEEL_TEST_OTP_CODE', FIXED)
    const code = generateOtpCode()
    expect(code).not.toBe(FIXED)
    expect(code).toMatch(/^\d{6}$/)
  })

  it('ignores a malformed fixed code', () => {
    setEnv('NODE_ENV', 'test')
    setEnv('LIFEKEEL_TEST_OTP_CODE', 'not-digits')
    expect(generateOtpCode()).toMatch(/^\d{6}$/)
    expect(generateOtpCode()).not.toBe('not-digits')
  })

  it('generates six digits when the var is unset', () => {
    setEnv('LIFEKEEL_TEST_OTP_CODE', undefined)
    for (let i = 0; i < 20; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/)
  })
})

describe('evaluateOtpBoot', () => {
  it('flags LIFEKEEL_TEST_OTP_CODE as a violation outside dev', () => {
    const { violations } = evaluateOtpBoot(
      { LIFEKEEL_TEST_OTP_CODE: FIXED, OTP_PEPPER: 'x'.repeat(32), SENDGRID_API_KEY: 'k' },
      'cloud',
    )
    expect(violations.some((v) => v.includes('LIFEKEEL_TEST_OTP_CODE'))).toBe(true)
  })

  it('does not flag it in dev', () => {
    const { violations } = evaluateOtpBoot({ LIFEKEEL_TEST_OTP_CODE: FIXED }, 'dev')
    expect(violations.some((v) => v.includes('LIFEKEEL_TEST_OTP_CODE'))).toBe(false)
  })
})
