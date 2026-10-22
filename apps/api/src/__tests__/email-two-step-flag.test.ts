import { describe, expect, it } from 'vitest'
import { emailTwoStepFromEnv } from '../local-model.js'

describe('emailTwoStepFromEnv', () => {
  it('is off by default', () => {
    expect(emailTwoStepFromEnv({})).toBe(false)
    expect(emailTwoStepFromEnv({ LOCAL_JUDGE_BASE_URL: 'http://judge:11434' })).toBe(false)
  })

  it('needs both the flag and the self-hosted model', () => {
    expect(emailTwoStepFromEnv({ EMAIL_TWO_STEP: 'true' })).toBe(false)
    expect(
      emailTwoStepFromEnv({ EMAIL_TWO_STEP: 'true', LOCAL_JUDGE_BASE_URL: 'http://judge:11434' }),
    ).toBe(true)
  })

  it.each(['1', 'yes', 'TRUE', 'false', ''])('treats %j as off', (v) => {
    expect(
      emailTwoStepFromEnv({ EMAIL_TWO_STEP: v, LOCAL_JUDGE_BASE_URL: 'http://judge:11434' }),
    ).toBe(false)
  })
})
