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
    render(<PendingApproval />)
    expect(screen.getByText(/Your request is with the family.s organizer/)).toBeTruthy()
    expect(screen.getByText(/we will email the address you gave/)).toBeTruthy()
    expect(screen.getByText(/stays open for 14 days/)).toBeTruthy()
    expect(screen.getByText(/send a new request/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/let .* know|notified|we.ve told/i)
  })

  it('does not name the family: the person asking may be someone the family is avoiding', () => {
    render(<PendingApproval />)
    expect(document.body.textContent).not.toMatch(/The [A-Z]\w+/)
  })

  it('offers sign-in as a 48px link worded for people already approved', () => {
    render(<PendingApproval />)
    const link = screen.getByRole('link', { name: 'Already approved? Sign in' })
    expect(link.getAttribute('href')).toBe('/login')
    expect(link.className).toContain('min-h-[48px]')
  })
})
