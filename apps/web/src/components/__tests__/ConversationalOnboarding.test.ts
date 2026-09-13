import { describe, expect, it, vi } from 'vitest'
import { signUpWithCollisionRetry } from '../ConversationalOnboarding'

describe('OAK-017: signUpWithCollisionRetry', () => {
  it('returns the first signUp result when there is no collision', async () => {
    const signUp = vi.fn(async (_name: string, email: string) => ({ email }))
    const result = await signUpWithCollisionRetry('Alex', 'alex@family.ai', 'pw', signUp)
    expect(result).toEqual({ email: 'alex@family.ai' })
    expect(signUp).toHaveBeenCalledTimes(1)
  })

  it('retries once with a suffixed email on an "Email already registered" collision', async () => {
    const signUp = vi.fn()
      .mockRejectedValueOnce(new Error('Email already registered'))
      .mockResolvedValueOnce({ email: 'retried' })

    const result = await signUpWithCollisionRetry('Alex', 'alex@family.ai', 'pw', signUp)

    expect(result).toEqual({ email: 'retried' })
    expect(signUp).toHaveBeenCalledTimes(2)
    const secondCallEmail = signUp.mock.calls[1]![1] as string
    expect(secondCallEmail).toMatch(/^alex\.[a-z0-9]+@family\.ai$/)
    expect(secondCallEmail).not.toBe('alex@family.ai')
  })

  it('does not retry and rethrows for any other error', async () => {
    const signUp = vi.fn().mockRejectedValueOnce(new Error('Network error'))
    await expect(signUpWithCollisionRetry('Alex', 'alex@family.ai', 'pw', signUp)).rejects.toThrow('Network error')
    expect(signUp).toHaveBeenCalledTimes(1)
  })

  it('propagates a second collision on the retry instead of looping forever', async () => {
    const signUp = vi.fn()
      .mockRejectedValueOnce(new Error('Email already registered'))
      .mockRejectedValueOnce(new Error('Email already registered'))
    await expect(signUpWithCollisionRetry('Alex', 'alex@family.ai', 'pw', signUp)).rejects.toThrow('Email already registered')
    expect(signUp).toHaveBeenCalledTimes(2)
  })
})
