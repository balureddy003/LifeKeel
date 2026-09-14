import { describe, expect, it, vi } from 'vitest'
import { attemptOnboardingSignup, isValidEmailFormat, onboardingRecoveryEmailToLink } from '../ConversationalOnboarding'

describe('OAK-017: attemptOnboardingSignup', () => {
  it('returns ok:true with the signed-up user on success', async () => {
    const signUp = vi.fn(async (_name: string, email: string) => ({ email }))
    const outcome = await attemptOnboardingSignup('Alex', 'alex@example.com', 'pw', signUp)
    expect(outcome).toEqual({ ok: true, user: { email: 'alex@example.com' } })
    expect(signUp).toHaveBeenCalledTimes(1)
  })

  it('classifies an "Email already registered" error as a collision', async () => {
    const signUp = vi.fn(async () => { throw new Error('Email already registered') })
    const outcome = await attemptOnboardingSignup('Alex', 'alex@example.com', 'pw', signUp)
    expect(outcome).toEqual({ ok: false, reason: 'collision', message: 'Email already registered' })
  })

  it('classifies any other error as "other"', async () => {
    const signUp = vi.fn(async () => { throw new Error('Network error') })
    const outcome = await attemptOnboardingSignup('Alex', 'alex@example.com', 'pw', signUp)
    expect(outcome).toEqual({ ok: false, reason: 'other', message: 'Network error' })
  })

  it('does not retry with a mutated email on collision — unlike the old synthetic-email behavior', async () => {
    const signUp = vi.fn(async () => { throw new Error('Email already registered') })
    await attemptOnboardingSignup('Alex', 'alex@example.com', 'pw', signUp)

    // A real, user-provided email collision means they already have an
    // account — silently retrying with a suffixed variant would create a
    // second, unreachable account, so this must call signUp exactly once
    // with the original email, never a mutated one.
    expect(signUp).toHaveBeenCalledTimes(1)
    expect(signUp).toHaveBeenCalledWith('Alex', 'alex@example.com', 'pw')
  })

  it('falls back to a generic message for a non-Error throw', async () => {
    const signUp = vi.fn(async () => { throw 'weird non-error throw' })
    const outcome = await attemptOnboardingSignup('Alex', 'alex@example.com', 'pw', signUp)
    expect(outcome).toEqual({ ok: false, reason: 'other', message: 'Something went wrong creating your account.' })
  })
})

describe('isValidEmailFormat', () => {
  it.each([
    'a@ea@example.comxample.com', // the exact malformed shape found during manual testing
    'not-an-email',
    'missing-domain@',
    '@missing-local.com',
    'no-dot-in-domain@example',
  ])('rejects %s', (value) => {
    expect(isValidEmailFormat(value)).toBe(false)
  })

  it('accepts a well-formed email', () => {
    expect(isValidEmailFormat('real.person@example.com')).toBe(true)
  })

  it('trims surrounding whitespace before checking', () => {
    expect(isValidEmailFormat('  real.person@example.com  ')).toBe(true)
  })
})

describe('live-verification finding: onboardingRecoveryEmailToLink', () => {
  it('returns null when there is no already-authenticated owner (the signup-first-time path handles email separately)', () => {
    expect(onboardingRecoveryEmailToLink(null, 'someone@example.com')).toBeNull()
  })

  it('returns null when no email answer was given', () => {
    expect(onboardingRecoveryEmailToLink({ email: 'original@example.com' }, undefined)).toBeNull()
  })

  it('returns null when the answer already matches the account email — nothing to link', () => {
    expect(onboardingRecoveryEmailToLink({ email: 'same@example.com' }, 'same@example.com')).toBeNull()
  })

  it('returns the trimmed email to link when it differs from the account email — the bug this fixes: this used to be silently discarded for anyone who signed up before onboarding', () => {
    expect(onboardingRecoveryEmailToLink({ email: 'signup-address@example.com' }, '  recovery-address@example.com  ')).toBe(
      'recovery-address@example.com',
    )
  })
})
