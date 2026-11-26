import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const fetchTrust = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ fetchTrust }))
import TrustPage from '../page'
import { STATUS_TEXT } from '@/lib/ai-disclosure-copy'
const STATUS_UNREVIEWED = STATUS_TEXT.terms_under_review

const ai = (status: string) => ({
  generated_at: '2026-10-20',
  processors: [{ id: 'p1', name: 'Hosted one', status, retention: ['none'], hosting: 'hosted' }],
  tasks: [],
})

beforeEach(() => fetchTrust.mockReset())

describe('trust page', () => {
  it('shows no empty claims section instead of inventing claims, and shows the live processors', async () => {
    fetchTrust.mockResolvedValue({
      claims: [],
      ai: ai('terms_under_review'),
      backups: { retention_days: null, statement: 'The backup window has not been confirmed.' },
    })
    render(<TrustPage />)
    await waitFor(() => expect(screen.getByText('Hosted one')).toBeTruthy())
    expect(screen.queryByText(/Nothing is listed here yet/)).toBeNull()
    expect(screen.queryByRole('heading', { name: /What we state/ })).toBeNull()
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

  it('opens with four plain answers that each link to where the thing can be done', async () => {
    fetchTrust.mockResolvedValue({
      claims: [],
      ai: ai('run_by_lifekeel'),
      backups: { retention_days: null, statement: 'x' },
    })
    render(<TrustPage />)
    expect(screen.getByRole('heading', { name: 'In short' })).toBeTruthy()
    for (const q of [
      'Who can see your list?',
      'How is AI used?',
      'Can you take your data with you?',
      'Can you delete it?',
      'Can AI help without your words leaving your device?',
    ])
      expect(screen.getByText(q)).toBeTruthy()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining(['/family', '/ai-processing', '/settings']))
    await waitFor(() => expect(screen.getByText('Hosted one')).toBeTruthy())
  })

  it('lists only processors that can receive a call here, and names the rest in one line', async () => {
    fetchTrust.mockResolvedValue({
      claims: [],
      ai: {
        generated_at: '2026-11-22',
        processors: [
          {
            id: 'g',
            name: 'Groq',
            status: 'approved',
            retention: ['none'],
            hosting: 'hosted',
            in_use: true,
          },
          {
            id: 'a',
            name: 'Anthropic',
            status: 'terms_under_review',
            retention: ['unknown'],
            hosting: 'hosted',
            in_use: false,
          },
          {
            id: 'o',
            name: 'Self-hosted model',
            status: 'run_by_lifekeel',
            retention: ['none'],
            hosting: 'self_hosted',
            in_use: false,
          },
        ],
        tasks: [],
      },
      backups: { retention_days: 35, statement: 'up to 35 days' },
    })
    render(<TrustPage />)
    await waitFor(() => expect(screen.getByText('Groq')).toBeTruthy())
    expect(screen.queryByText('Anthropic')).toBeNull()
    expect(screen.getByText(/not used here: Anthropic, Self-hosted model/)).toBeTruthy()
    expect(screen.queryByText(STATUS_UNREVIEWED)).toBeNull()
  })
})
