import { describe, expect, it } from 'vitest'
import { FreeTierPolicy } from '../free-tier-policy.js'

describe('FreeTierPolicy', () => {
  it('enforces free-tier limits and leaves paid tiers unlimited', () => {
    const policy = new FreeTierPolicy()
    expect(policy.check('active_goals', 2, 'free').allowed).toBe(true)
    expect(policy.check('active_goals', 3, 'free').allowed).toBe(false)
    expect(policy.check('monthly_move_approvals', 100, 'practice').allowed).toBe(true)
  })
})
