import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MobileMenu } from '../AppNav'

vi.mock('next/navigation', () => ({ usePathname: () => '/member/abc' }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/lib/store', () => ({
  useAppStore: (pick: (s: { inboxUnreadCount: number }) => number) => pick({ inboxUnreadCount: 3 }),
}))

describe('MobileMenu', () => {
  it('opens a dialog with the primary routes, marks the current tab and closes on Escape', async () => {
    render(<MobileMenu />)
    const trigger = screen.getByRole('button', { name: 'Open menu' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    screen.getByRole('dialog', { name: 'Menu' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    for (const label of ['Home', 'Events', 'Ask Keel', 'Family', 'Settings', 'Inbox', 'Finances']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeTruthy()
    }
    // /member/* belongs to the Family tab.
    expect(screen.getByRole('link', { name: /Family/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Home/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: /Inbox/ }).textContent).toContain('3')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
