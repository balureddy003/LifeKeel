import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { NativeRegionGate } from '../NativeRegionGate'

function fakeShell(initial: Record<string, string> = {}) {
  const store = { ...initial }
  const set = vi.fn(async ({ key, value }: { key: string; value: string }) => {
    store[key] = value
  })
  ;(window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: {
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
})
