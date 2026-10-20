import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const auth = vi.hoisted(() => ({ isAuthenticated: true }))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth }))
const track = vi.hoisted(() => vi.fn())
vi.mock('@/lib/growth-track', () => ({ track }))
vi.mock('@/lib/native', () => ({ isNativeShell: () => false }))
vi.mock('@/lib/platform', () => ({ isIOS: () => false, isStandalone: () => false }))

import { InstallHint } from '../InstallHint'

function promptEvent() {
  const e = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: string }>
  }
  e.prompt = vi.fn().mockResolvedValue(undefined)
  e.userChoice = Promise.resolve({ outcome: 'accepted' })
  return e
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('lifekeel_visits', '1') // this render is the second visit
  track.mockClear()
  auth.isAuthenticated = true
})
afterEach(() => vi.clearAllMocks())

describe('InstallHint', () => {
  it('shows after the browser offers an install and sends only the platform', () => {
    render(<InstallHint />)
    expect(screen.queryByRole('region')).toBeNull()
    act(() => {
      window.dispatchEvent(promptEvent())
    })
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
    expect(track).toHaveBeenCalledWith('pwa_install_shown', { p: 'prompt' })
  })

  it('triggers the saved prompt on Install', async () => {
    render(<InstallHint />)
    const e = promptEvent()
    act(() => {
      window.dispatchEvent(e)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    })
    expect(e.prompt).toHaveBeenCalled()
    expect(track).toHaveBeenCalledWith('pwa_install_clicked', { p: 'prompt' })
  })

  it('remembers a dismissal on this device', () => {
    render(<InstallHint />)
    act(() => {
      window.dispatchEvent(promptEvent())
    })
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('region')).toBeNull()
    expect(localStorage.getItem('lifekeel_install_dismissed_at')).toBeTruthy()
  })

  it('stays hidden on the first visit and when signed out', () => {
    localStorage.clear()
    render(<InstallHint />)
    act(() => {
      window.dispatchEvent(promptEvent())
    })
    expect(screen.queryByRole('region')).toBeNull()
  })
})
