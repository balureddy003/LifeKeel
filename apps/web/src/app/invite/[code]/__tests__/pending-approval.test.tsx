/**
 * After asking to join, the screen says only what is true: the request is with
 * the organizer, an email follows approval, and it does not claim the
 * organizer was told (they see it when they open the app).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { PendingApproval } from '../PendingApproval'

afterEach(cleanup)

describe('PendingApproval', () => {
  it('names the organizer step and promises the email, not a notification', () => {
    render(<PendingApproval familyName="The Reddys" />)
    expect(screen.getByText(/Your request is with The Reddys.s organizer/)).toBeTruthy()
    expect(screen.getByText(/we will email you/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/let .* know|notified|we.ve told/i)
  })

  it('offers sign-in as a 48px link worded for people already approved', () => {
    render(<PendingApproval familyName="The Reddys" />)
    const link = screen.getByRole('link', { name: 'Already approved? Sign in' })
    expect(link.getAttribute('href')).toBe('/login')
    expect(link.className).toContain('min-h-[48px]')
  })
})
