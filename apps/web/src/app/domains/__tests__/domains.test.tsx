/**
 * The cover page states what is on file and who has seen it. Confirm is offered
 * only until this adult has confirmed, and a stale version reloads the page.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import DomainsPage from '../page'
import { cellText, confirmSummary } from '../domain-copy'
import type { DomainView } from '@/lib/api'

const getDomains = vi.fn()
const getDomainView = vi.fn()
const confirmDomain = vi.fn()
const toast = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getDomains: () => getDomains(),
  getDomainView: (id: string) => getDomainView(id),
  confirmDomain: (id: string, v: string) => confirmDomain(id, v),
}))
vi.mock('@/components/Toast', () => ({ useToast: () => toast }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const view = (
  over: Partial<DomainView['confirmation']> = {},
  gaps: DomainView['gaps'] = [],
): DomainView => ({
  domain_id: 'life_protection',
  rows: [],
  matrix: {
    label: 'Who is covered by what',
    columns: [
      { id: 'sam', name: 'Sam' },
      { id: 'alex', name: 'Alex' },
    ],
    rows: [{ id: 'p1', label: 'Policy · Provider A', cells: { sam: 'holds', alex: 'covers' } }],
  },
  gaps,
  result_version: 'a'.repeat(64),
  confirmation: {
    required: [
      { id: 'sam', name: 'Sam' },
      { id: 'alex', name: 'Alex' },
    ],
    confirmed: [],
    both_confirmed: false,
    viewer_confirmed: false,
    ...over,
  },
})

beforeEach(() => {
  window.history.pushState({}, '', '/domains?d=life_protection')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('domains page', () => {
  it('lists the packs when no domain is chosen', async () => {
    window.history.pushState({}, '', '/domains')
    getDomains.mockResolvedValue({
      domains: [
        {
          id: 'life_protection',
          title: 'Life and income protection',
          summary: 'Which policies are on file.',
          confirm: 'both_adults',
        },
      ],
    })
    render(<DomainsPage />)
    expect(await screen.findByText('Life and income protection')).toBeTruthy()
  })

  it('shows the matrix in words, the gaps, and who is still to confirm', async () => {
    getDomainView.mockResolvedValue(
      view({}, [{ row_id: 'p1', note: 'Not yet matched to a family member' }]),
    )
    render(<DomainsPage />)
    expect(await screen.findByText('Holds it')).toBeTruthy()
    expect(screen.getByText('Covered')).toBeTruthy()
    expect(screen.getByText(/Not yet matched to a family member/)).toBeTruthy()
    expect(
      screen.getByText('Waiting for Sam and Alex to confirm they have seen this version.'),
    ).toBeTruthy()
  })

  it('confirms the exact version shown, then hides the button', async () => {
    getDomainView.mockResolvedValue(view())
    confirmDomain.mockResolvedValue({
      ok: true,
      status: 200,
      data: view({
        viewer_confirmed: true,
        confirmed: [{ id: 'sam', name: 'Sam', confirmed_at: 'x' }],
      }),
    })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'I have seen this' }))
    await waitFor(() =>
      expect(confirmDomain).toHaveBeenCalledWith('life_protection', 'a'.repeat(64)),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'I have seen this' })).toBeNull(),
    )
    expect(
      screen.getByText('Waiting for Alex to confirm they have seen this version.'),
    ).toBeTruthy()
  })

  it('offers no button to an adult who already confirmed', async () => {
    getDomainView.mockResolvedValue(view({ viewer_confirmed: true }))
    render(<DomainsPage />)
    await screen.findByText('Holds it')
    expect(screen.queryByRole('button', { name: 'I have seen this' })).toBeNull()
  })

  it('reloads the current version when the one confirmed has changed', async () => {
    getDomainView.mockResolvedValue(view())
    confirmDomain.mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: 'This changed since you opened it. Review it again.' },
    })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'I have seen this' }))
    await waitFor(() => expect(getDomainView).toHaveBeenCalledTimes(2))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('says so, without a button, when nothing is on file or it cannot load', async () => {
    getDomainView.mockResolvedValue({ ...view(), matrix: { label: 'x', columns: [], rows: [] } })
    render(<DomainsPage />)
    expect(await screen.findByText(/Nothing on file yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'I have seen this' })).toBeNull()
    cleanup()
    getDomainView.mockResolvedValue(null)
    render(<DomainsPage />)
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
  })
})

describe('domain copy', () => {
  it('describes cells and confirmation as facts', () => {
    expect(cellText(null)).toBe('Not recorded')
    expect(cellText('holds_and_covers')).toBe('Holds it and is covered')
    expect(confirmSummary(view({ both_confirmed: true }).confirmation)).toBe(
      'All 2 adults have seen this version.',
    )
    expect(
      confirmSummary({
        required: [],
        confirmed: [],
        both_confirmed: false,
        viewer_confirmed: false,
      }),
    ).toMatch(/No adults/)
  })
})
