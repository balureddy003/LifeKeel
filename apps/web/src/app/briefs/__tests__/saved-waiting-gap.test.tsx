/** A saved brief states its waiting-period gap when opened, not only on a fresh result (innovation scan idea 3). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ family: { members: [{ id: 'm1', role: 'organizer', status: 'active' }] } }),
}))
vi.mock('@/components/EmergencyRow', () => ({ EmergencyRow: () => null }))
vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))
vi.mock('@/components/ConfirmSheetProvider', () => ({ useConfirm: () => vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getBriefCatalogue: vi.fn().mockResolvedValue({
    catalogue: [
      {
        id: 'income_stops',
        title: 'One of us might stop earning',
        group: 'Money and income',
        mode: 'stop',
        trigger: 'Income stop date',
      },
    ],
    recipients: [],
    can_create: true,
  }),
  listBriefs: vi.fn().mockResolvedValue([
    {
      id: 'b1',
      problem_type: 'income_stops',
      title: 'One of us might stop earning',
      inputs: { change_date: '2099-01-01' },
      result: {
        projectedRunwayMonths: 5.3,
        waitingGap: {
          months: 2.3,
          runsOutMonth: 4.6,
          coverStartsMonth: 7,
          runsOut: 'April 2027',
          coverStarts: 'June 2027',
        },
      },
      template_sentence:
        'If the income stops, savings would run out around June 2027 (about month 5.3 after the change).',
      solver_version: '1',
      data_version: '1',
      stale: false,
      share: null,
      link_fetched_at: null,
      confirmed_opened_at: null,
      created_by: 'u1',
      created_at: '2026-11-21T10:00:00Z',
    },
  ]),
}))
import BriefsPage from '../page'

afterEach(cleanup)

describe('saved brief', () => {
  it('shows the waiting-period gap when opened', async () => {
    render(<BriefsPage />)
    const toggle = (await screen.findAllByRole('button')).find(
      (b) => b.textContent?.includes('stop earning') && b.hasAttribute('aria-expanded'),
    )!
    fireEvent.click(toggle)
    expect((await screen.findByTestId('waiting-gap-note')).textContent).toMatch(
      /about 2\.3 months before the cover payment starts: from around April 2027 until around June 2027/,
    )
  })
})
