/** R39: emailed tokens are read from the fragment and removed from the address bar. */
import { describe, expect, it } from 'vitest'
import { readLinkToken } from '@/lib/link-token'

describe('readLinkToken', () => {
  it('reads the fragment, clears the URL, and still answers a second (strict-mode) call', () => {
    window.history.replaceState(null, '', '/reset-password/confirm#token=abc123')
    expect(readLinkToken()).toBe('abc123')
    expect(window.location.hash).toBe('')
    expect(readLinkToken()).toBe('abc123')
  })

  it('still accepts the older ?token= links', () => {
    window.history.replaceState(null, '', '/verify-email?token=legacy1')
    expect(readLinkToken()).toBe('legacy1')
    expect(window.location.search).toBe('')
  })
})
