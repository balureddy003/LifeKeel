/**
 * R36: advertising and analytics tags only with consent, only on public
 * pages, and never for a signed-in visitor or on token-bearing links.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isTrackablePath, readConsent, reopenConsent, writeConsent } from '@/lib/consent'

beforeEach(() => localStorage.clear())

describe('isTrackablePath', () => {
  it('allows the public marketing pages for signed-out visitors', () => {
    for (const p of ['/', '/signup', '/blog', '/blog/post-1', '/guides/x', '/readiness']) {
      expect(isTrackablePath(p, false), p).toBe(true)
    }
  })

  it('never inside the app, on recovery or invite links, or for a signed-in visitor', () => {
    for (const p of [
      '/reset-password/confirm',
      '/verify-email',
      '/invite/abc',
      '/financial-profile',
      '/vault',
      '/settings',
      '/login',
      '/blogx',
    ]) {
      expect(isTrackablePath(p, false), p).toBe(false)
    }
    expect(isTrackablePath('/', true)).toBe(false)
    expect(isTrackablePath('/blog', true)).toBe(false)
  })
})

describe('consent choice', () => {
  it('has no default: nothing is consented until the visitor chooses', () => {
    expect(readConsent()).toBeNull()
    writeConsent('accepted')
    expect(readConsent()).toBe('accepted')
  })

  it('can be withdrawn; withdrawing after accepting reloads so loaded tags stop', () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    })
    writeConsent('accepted')
    writeConsent('rejected')
    expect(readConsent()).toBe('rejected')
    expect(reload).toHaveBeenCalledTimes(1)
    reopenConsent()
    expect(readConsent()).toBeNull()
  })
})
