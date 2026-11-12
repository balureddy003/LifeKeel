import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { OperatorAccessEntry } from '@/lib/api'

const fetchOperatorAccess = vi.fn<() => Promise<OperatorAccessEntry[] | null>>()
vi.mock('@/lib/api', () => ({
  fetchAuditLog: () => Promise.resolve([]),
  fetchOperatorAccess: () => fetchOperatorAccess(),
}))

import AuditLogPage from '../audit-log/page'

afterEach(() => {
  cleanup()
  fetchOperatorAccess.mockReset()
})

describe('Activity Log — LifeKeel staff access (G-OFI-04)', () => {
  it('lists staff access in plain words and says whose account it was', async () => {
    fetchOperatorAccess.mockResolvedValue([
      {
        action: 'operator.user.view',
        target_type: 'user',
        about_you: true,
        timestamp: new Date().toISOString(),
      },
      {
        action: 'operator.user.password_reset',
        target_type: 'user',
        about_you: false,
        timestamp: new Date().toISOString(),
      },
      {
        action: 'operator.tenant.view',
        target_type: 'tenant',
        about_you: false,
        timestamp: new Date().toISOString(),
      },
    ])
    render(<AuditLogPage />)
    expect(
      await screen.findByText('LifeKeel staff opened the account to help with support (yours)'),
    ).toBeTruthy()
    expect(
      screen.getByText('LifeKeel staff sent a password reset (a family member’s)'),
    ).toBeTruthy()
    expect(
      screen.getByText('LifeKeel staff opened your family’s record to help with support'),
    ).toBeTruthy()
  })

  it('says so when no one at LifeKeel has opened the account', async () => {
    fetchOperatorAccess.mockResolvedValue([])
    render(<AuditLogPage />)
    expect(
      await screen.findByText('No one at LifeKeel has opened your family’s account.'),
    ).toBeTruthy()
  })

  it('shows an error, not "no access", when the list cannot be loaded', async () => {
    fetchOperatorAccess.mockResolvedValue(null)
    render(<AuditLogPage />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('No one at LifeKeel has opened your family’s account.')).toBeNull()
  })
})
