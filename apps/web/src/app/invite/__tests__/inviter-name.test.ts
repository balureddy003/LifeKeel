/** The sender's name rides in the invite link; anything that is not a plain name is ignored. */
import { describe, expect, it, vi } from 'vitest'
import { inviterFirstName } from '../[code]/InviteJoinClient'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('inviterFirstName', () => {
  it('reads a plain first name', () => {
    expect(inviterFirstName('?from=Jo')).toBe('Jo')
    expect(inviterFirstName('?from=Zo%C3%AB')).toBe('Zoë')
  })
  it('ignores missing, long or non-name values', () => {
    expect(inviterFirstName('')).toBeUndefined()
    expect(inviterFirstName('?from=' + 'a'.repeat(31))).toBeUndefined()
    expect(inviterFirstName('?from=%3Cscript%3E')).toBeUndefined()
    expect(inviterFirstName('?from=Jo%20http://x.co')).toBeUndefined()
  })
})
