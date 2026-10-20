import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const fetchTrust = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ fetchTrust }))
import TrustPage from '../page'

const ai = (status: string) => ({
  generated_at: '2026-10-20',
  processors: [{ id: 'p1', name: 'Hosted one', status, retention: ['none'], hosting: 'hosted' }],
  tasks: [],
})

beforeEach(() => fetchTrust.mockReset())

describe('trust page', () => {
  it('says nothing is listed yet instead of inventing claims, and shows the live processors', async () => {
    fetchTrust.mockResolvedValue({
      claims: [],
      ai: ai('terms_under_review'),
      backups: { retention_days: null, statement: 'The backup window has not been confirmed.' },
    })
    render(<TrustPage />)
    await waitFor(() => expect(screen.getByText(/Nothing is listed here yet/)).toBeTruthy())
    expect(screen.getByText('Hosted one')).toBeTruthy()
    expect(screen.getByText(/has not been confirmed/)).toBeTruthy()
    expect(screen.queryByText(/certified|audited|penetration/i)).toBeNull()
  })

  it('shows an evidenced claim with its evidence and confirmation date', async () => {
    fetchTrust.mockResolvedValue({
      claims: [
        {
          id: 'no_commission',
          statement: 'LifeKeel takes no commission or referral fee from any provider.',
          evidence: { kind: 'commitment', how: 'Owner attestation.' },
          verified_at: '2026-10-01T00:00:00.000Z',
        },
      ],
      ai: ai('terms_under_review'),
      backups: { retention_days: 35, statement: 'up to 35 days' },
    })
    render(<TrustPage />)
    await waitFor(() => expect(screen.getByText(/no commission or referral fee/)).toBeTruthy())
    expect(screen.getByText(/Last confirmed 2026-10-01/)).toBeTruthy()
  })

  it('says the information is unavailable when the API cannot be reached', async () => {
    fetchTrust.mockResolvedValue(null)
    render(<TrustPage />)
    await waitFor(() => expect(screen.getByText(/not available right now/)).toBeTruthy())
  })
})
