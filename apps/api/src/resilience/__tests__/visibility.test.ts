import { describe, it, expect } from 'vitest'
import { canSeeEngineOutput, engineViewFor, type VisibilityMember } from '../visibility.js'

// Intent 94, R11 (owner decision 2026-11-14, A5): adult members of the family see each other's figures.
// Only that narrow rule is built. Leaving or disputed adults (H23, H25, H26), a lodger's view (H29) and the
// external link (PRD-229) are NOT decided here, so those cases see nothing.
const members: VisibilityMember[] = [
  { id: 'm-org', user_id: 'u-org', role: 'organizer', status: 'active' },
  { id: 'm-adult', user_id: 'u-adult', role: 'adult', status: 'active' },
  { id: 'm-parent', role: 'parent', status: 'active' },
  { id: 'm-child', user_id: 'u-child', role: 'child', status: 'active' },
  {
    id: 'm-teen',
    user_id: 'u-teen',
    role: 'adult',
    status: 'active',
    date_of_birth: new Date().getFullYear() - 15 + '-01-01',
  },
  { id: 'm-pending', user_id: 'u-pending', role: 'adult', status: 'pending' },
  { id: 'm-removed', user_id: 'u-removed', role: 'adult', status: 'removed' },
  { id: 'm-odd', user_id: 'u-odd', role: 'lodger', status: 'active' },
]

describe('canSeeEngineOutput', () => {
  it('active adult members see it, whether matched by user_id or by member id', () => {
    expect(canSeeEngineOutput(members, 'u-org')).toBe(true)
    expect(canSeeEngineOutput(members, 'u-adult')).toBe(true)
    expect(canSeeEngineOutput(members, 'm-parent')).toBe(true)
  })
  it('a child, an under-18 adult-labelled member, a pending or removed member see nothing', () => {
    for (const u of ['u-child', 'u-teen', 'u-pending', 'u-removed']) {
      expect(canSeeEngineOutput(members, u)).toBe(false)
    }
  })
  it('an undecided role (lodger, viewer, anything else) fails closed', () => {
    expect(canSeeEngineOutput(members, 'u-odd')).toBe(false)
  })
  it('someone who is not in the family, or no user at all, sees nothing', () => {
    expect(canSeeEngineOutput(members, 'u-stranger')).toBe(false)
    expect(canSeeEngineOutput(members, '')).toBe(false)
    expect(canSeeEngineOutput([], 'u-org')).toBe(false)
  })
})

describe('engineViewFor', () => {
  const output = { runway: '3 months' }
  it('returns the output to an allowed viewer and null to everyone else', () => {
    expect(engineViewFor(members, 'u-adult', output)).toBe(output)
    expect(engineViewFor(members, 'u-child', output)).toBeNull()
    expect(engineViewFor(members, 'u-odd', output)).toBeNull()
  })
})
