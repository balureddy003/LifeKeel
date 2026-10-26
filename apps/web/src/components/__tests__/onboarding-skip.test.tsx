import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConversationalOnboarding } from '../ConversationalOnboarding'

const mocks = vi.hoisted(() => ({
  createFamily: vi.fn(),
  replace: vi.fn(),
  hasFamily: false,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'owner', name: 'Alex', email: 'alex@example.com', avatar: '' },
    family: mocks.hasFamily ? { id: 'existing' } : null,
    isLoading: false,
    createFamily: mocks.createFamily,
  }),
}))
vi.mock('@/components/security/Turnstile', () => ({
  Turnstile: () => null,
  useTurnstile: () => ({ ready: true }),
}))
vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasFamily = false
  mocks.createFamily.mockResolvedValue(undefined)
  Element.prototype.scrollTo = vi.fn()
})
afterEach(cleanup)

describe('optional family setup', () => {
  it('creates only the minimal family and opens the dashboard when skipped', async () => {
    render(<ConversationalOnboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'))
    expect(mocks.createFamily).toHaveBeenCalledTimes(1)
    expect(mocks.createFamily.mock.calls[0]?.[0]).toBe("Alex's Family")
  })

  it('keeps an existing family when skipped', async () => {
    mocks.hasFamily = true
    render(<ConversationalOnboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'))
    expect(mocks.createFamily).not.toHaveBeenCalled()
  })

  it('keeps setup available and allows retry after a failed skip', async () => {
    mocks.createFamily.mockRejectedValueOnce(new Error('Offline'))
    render(<ConversationalOnboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t skip right now')
    expect(mocks.replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'))
  })
})
