import { describe, expect, it, vi } from 'vitest'
import { attemptOnboardingSignup } from '../ConversationalOnboarding'

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
