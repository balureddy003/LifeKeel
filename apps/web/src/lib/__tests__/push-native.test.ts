/**
 * PRD-140 native shell push: permission, token, registration with the API,
 * and sign-out unregistration using the session token captured up front.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const credFetch = vi.fn()
vi.mock('../http', () => ({ credFetch: (...a: unknown[]) => credFetch(...a) }))
vi.mock('../env', () => ({ getApiBase: () => 'https://api.test' }))

import { subscribeNativePush, unregisterAllPush, unsubscribeNativePush } from '../push'

type Cb = (d: { value?: string; error?: string }) => void

function fakeShell(opts: { permission?: string; token?: string | null; platform?: string } = {}) {
  const prefs = new Map<string, string>()
  const listeners: Record<string, Cb> = {}
  ;(window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => opts.platform ?? 'ios',
    Plugins: {
      Preferences: {
        get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
        set: async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value),
      },
      PushNotifications: {
        requestPermissions: async () => ({ receive: opts.permission ?? 'granted' }),
        addListener: async (ev: string, cb: Cb) => {
          listeners[ev] = cb
          return { remove: async () => {} }
        },
        register: async () => {
          if (opts.token === null) listeners['registrationError']?.({ error: 'no' })
          else listeners['registration']?.({ value: opts.token ?? 'device-token-abc' })
        },
      },
    },
  }
  return { prefs }
}

const ok = () => Promise.resolve({ ok: true })

beforeEach(() => {
  localStorage.clear()
  credFetch.mockReset()
  credFetch.mockImplementation(ok)
})
afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})

describe('subscribeNativePush', () => {
  it('registers the token with its platform and remembers it for sign-out', async () => {
    const { prefs } = fakeShell({ platform: 'android' })
    localStorage.setItem('lifekeel_token', 'sess-1')
    expect(await subscribeNativePush()).toBe(true)
    const [url, init] = credFetch.mock.calls[0]!
    expect(url).toBe('https://api.test/push/mobile/subscribe')
    expect(JSON.parse(init.body)).toEqual({ token: 'device-token-abc', platform: 'android' })
    expect(init.headers.Authorization).toBe('Bearer sess-1')
    expect(prefs.get('lifekeel_push_token')).toBe('device-token-abc')
  })

  it('does nothing when permission is denied, no token arrives, or it is not the shell', async () => {
    fakeShell({ permission: 'denied' })
    expect(await subscribeNativePush()).toBe(false)
    fakeShell({ token: null })
    expect(await subscribeNativePush()).toBe(false)
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    expect(await subscribeNativePush()).toBe(false)
    expect(credFetch).not.toHaveBeenCalled()
  })

  it('does not remember a token the server refused', async () => {
    const { prefs } = fakeShell()
    credFetch.mockResolvedValue({ ok: false })
    expect(await subscribeNativePush()).toBe(false)
    expect(prefs.get('lifekeel_push_token')).toBeUndefined()
  })
})

describe('sign-out unregistration', () => {
  it('drops the stored token on the server and forgets it', async () => {
    const { prefs } = fakeShell()
    prefs.set('lifekeel_push_token', 'device-token-abc')
    expect(await unsubscribeNativePush('sess-9')).toBe(true)
    const [url, init] = credFetch.mock.calls[0]!
    expect(url).toBe('https://api.test/push/mobile/unsubscribe')
    expect(JSON.parse(init.body)).toEqual({ token: 'device-token-abc' })
    expect(init.headers.Authorization).toBe('Bearer sess-9')
    expect(prefs.get('lifekeel_push_token')).toBe('')
  })

  it('is a no-op when this device never registered', async () => {
    fakeShell()
    expect(await unsubscribeNativePush('sess-9')).toBe(true)
    expect(credFetch).not.toHaveBeenCalled()
  })

  it('uses the session token read at the start even if the local wipe removes it first', async () => {
    const { prefs } = fakeShell()
    prefs.set('lifekeel_push_token', 'device-token-abc')
    localStorage.setItem('lifekeel_token', 'sess-captured')
    const done = unregisterAllPush()
    localStorage.removeItem('lifekeel_token') // what purgeClientData does synchronously
    await done
    expect(credFetch).toHaveBeenCalledTimes(1)
    expect(credFetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer sess-captured')
  })

  it('never throws, so sign-out cannot be blocked by a push failure', async () => {
    const { prefs } = fakeShell()
    prefs.set('lifekeel_push_token', 'device-token-abc')
    credFetch.mockRejectedValue(new Error('offline'))
    await expect(unregisterAllPush()).resolves.toBeUndefined()
  })
})
