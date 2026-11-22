import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { NativeRegionGate } from '../NativeRegionGate'

const splashHide = vi.fn(async () => {})

function fakeShell(initial: Record<string, string> = {}) {
  const store = { ...initial }
  const set = vi.fn(async ({ key, value }: { key: string; value: string }) => {
    store[key] = value
  })
  ;(window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: {
      SplashScreen: { hide: splashHide },
      Preferences: {
        get: async ({ key }: { key: string }) => ({ value: store[key] ?? null }),
        set,
      },
    },
  }
  return { store, set }
}

function atHost(host: string, language = 'en-GB') {
  const replace = vi.fn()
  vi.stubGlobal('location', { host, pathname: '/login', search: '', hash: '', replace })
  vi.stubGlobal('navigator', { ...window.navigator, language })
  return replace
}

afterEach(() => {
  splashHide.mockClear()
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
  localStorage.clear()
})

describe('NativeRegionGate', () => {
  it('sends a saved si region to the si app host', async () => {
    fakeShell({ lifekeel_region: 'si' })
    const replace = atHost('app.lifekeel.co.uk')
    render(<NativeRegionGate />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://app.lifekeel.si/login'))
  })

  it('guesses si from a Slovenian device on first launch and saves it', async () => {
    const shell = fakeShell()
    const replace = atHost('app.lifekeel.co.uk', 'sl-SI')
    render(<NativeRegionGate />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://app.lifekeel.si/login'))
    expect(shell.store['lifekeel_region']).toBe('si')
  })

  it('keeps an existing signed-in install on uk and records that', async () => {
    const shell = fakeShell()
    const replace = atHost('app.lifekeel.co.uk', 'sl-SI')
    localStorage.setItem('lifekeel_token', 'tok')
    render(<NativeRegionGate />)
    await waitFor(() => expect(shell.store['lifekeel_region']).toBe('uk'))
    expect(replace).not.toHaveBeenCalled()
  })

  it('does nothing in a plain browser', async () => {
    const replace = atHost('app.lifekeel.co.uk', 'sl-SI')
    render(<NativeRegionGate />)
    await new Promise((r) => setTimeout(r, 20))
    expect(replace).not.toHaveBeenCalled()
  })

  it('does nothing on localhost even inside the shell', async () => {
    fakeShell({ lifekeel_region: 'si' })
    const replace = atHost('localhost:3002')
    render(<NativeRegionGate />)
    await new Promise((r) => setTimeout(r, 20))
    expect(replace).not.toHaveBeenCalled()
  })

  it('hides the native launch screen once the app is up and not about to redirect', async () => {
    fakeShell({ lifekeel_region: 'uk' })
    atHost('app.lifekeel.co.uk')
    render(<NativeRegionGate />)
    await waitFor(() => expect(splashHide).toHaveBeenCalledTimes(1))
  })

  it('keeps the launch screen up while it redirects to the other region host', async () => {
    fakeShell({ lifekeel_region: 'si' })
    const replace = atHost('app.lifekeel.co.uk')
    render(<NativeRegionGate />)
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(splashHide).not.toHaveBeenCalled()
  })

  it('hides the web-style bar above the keyboard in the shell', async () => {
    const setAccessoryBarVisible = vi.fn(async () => {})
    fakeShell()
    ;(window as unknown as { Capacitor: { Plugins: Record<string, unknown> } }).Capacitor.Plugins[
      'Keyboard'
    ] = { setAccessoryBarVisible }
    atHost('app.lifekeel.co.uk')
    render(<NativeRegionGate />)
    await waitFor(() => expect(setAccessoryBarVisible).toHaveBeenCalledWith({ isVisible: false }))
  })
})
