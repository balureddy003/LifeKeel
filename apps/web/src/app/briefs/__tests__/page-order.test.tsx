/**
 * A first-time, solo parent should see the choice ("What is changing?") before the two notes about the brief,
 * so the first thing on the page is what to tap, not text to read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

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
  getBriefCatalogue: vi.fn().mockResolvedValue({ catalogue: [], recipients: [], can_create: true }),
  listBriefs: vi.fn().mockResolvedValue([]),
}))
import BriefsPage from '../page'

afterEach(cleanup)

describe('briefs page for a first-time solo household', () => {
  it('puts the choice before the two notes', async () => {
    render(<BriefsPage />)
    const choice = await screen.findByRole('heading', { name: 'What is changing?' })
    const free = screen.getByText('Your first brief is free')
    const solo = screen.getByText('This one is just for you')
    const before = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(choice, free)).toBe(true)
    expect(before(choice, solo)).toBe(true)
  })

  it('opens at the top, not wherever the previous screen was scrolled to', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    render(<BriefsPage />)
    await screen.findByRole('heading', { name: 'What is changing?' })
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    vi.unstubAllGlobals()
  })
})
