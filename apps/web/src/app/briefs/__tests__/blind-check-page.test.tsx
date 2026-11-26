/** Blind check on the Briefs page: the sharer's tick-box, and the other adult's view before answering. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u-alex' },
    family: {
      members: [
        { id: 'm1', name: 'Sam Stone', role: 'organizer', status: 'active', userId: 'u-sam' },
        { id: 'm2', name: 'Alex Stone', role: 'adult', status: 'active', userId: 'u-alex' },
      ],
    },
  }),
}))
vi.mock('@/components/EmergencyRow', () => ({ EmergencyRow: () => null }))
vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))
vi.mock('@/components/ConfirmSheetProvider', () => ({ useConfirm: () => vi.fn() }))

const api = vi.hoisted(() => ({ briefs: [] as unknown[] }))
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
      {
        id: 'handover_gap',
        title: 'What the other adult should know',
        group: 'Handover',
        mode: 'handover',
        trigger: 'Date',
        fields: ['Where the will is'],
      },
    ],
    recipients: [{ id: 'm2', name: 'Alex Stone', status: 'active' }],
    can_create: true,
  }),
  listBriefs: vi.fn(async () => api.briefs),
  previewBrief: vi.fn().mockResolvedValue({ ok: false, status: 400 }),
}))
import BriefsPage from '../page'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  api.briefs = []
})

describe('share step', () => {
  it('offers the blind check, ticked, for a money brief', async () => {
    window.history.replaceState(null, '', '/briefs?start=income_stops')
    render(<BriefsPage />)
    const box = (await screen.findByLabelText(
      /Ask Alex for their own figures first/,
    )) as HTMLInputElement
    expect(box.checked).toBe(true)
  })

  it('does not offer it on a handover brief', async () => {
    window.history.replaceState(null, '', '/briefs?start=handover_gap')
    render(<BriefsPage />)
    await screen.findByText(/Sharing with/)
    expect(screen.queryByLabelText(/for their own figures first/)).toBeNull()
  })
})

describe('the other adult, before answering', () => {
  it('sees the form, no answer, and nothing to try or update', async () => {
    api.briefs = [
      {
        id: 'b1',
        problem_type: 'income_stops',
        title: 'One of us might stop earning',
        inputs: {},
        result: null,
        template_sentence: '',
        stale: false,
        share: {
          for_member_id: 'm2',
          for_member_name: 'Alex Stone',
          expires_at: 'x',
          revoked: false,
        },
        confirmation: { creator_at: null, recipient_at: null, both_confirmed: false },
        blind_check: { status: 'waiting_for_you', fields: [] },
        link_fetched_at: null,
        confirmed_opened_at: null,
        created_by: 'u-sam',
        created_at: '2026-11-26T10:00:00Z',
      },
    ]
    render(<BriefsPage />)
    expect(await screen.findByText(/Before you see Sam's figures/)).toBeTruthy()
    expect(screen.queryByTestId('glance-answer')).toBeNull()
    expect(screen.getByText('Give your own figures first, then you will see theirs.')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Try a what-if', hidden: true }).closest('[hidden]'),
    ).not.toBeNull()
  })
})
