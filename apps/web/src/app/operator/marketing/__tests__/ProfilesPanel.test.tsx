import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ProfilesPanel } from '../_components/ProfilesPanel'
import type { ChannelProfileView } from '@/lib/api'

const toast = vi.fn()
vi.mock('@/components/Toast', () => ({ useToast: () => toast }))

const base = {
  checklist_items: ['account_created', 'bio_set'],
  checklist: {},
  actual: null,
  drift: [],
  problems: [],
  bio_limit: 256,
  saved: false,
  applied_at: null,
}
const bluesky: ChannelProfileView = {
  ...base,
  channel: 'bluesky',
  desired: { display_name: 'LifeKeel', handle: 'lifekeel.co.uk', bio: 'The wanted bio', link: 'https://lifekeel.co.uk/?utm_source=bluesky' },
  desired_hash: 'abc123',
  supports_check: true,
  supports_apply: true,
  actual: { display_name: 'LifeKeel', bio: 'An old bio', has_avatar: true, has_banner: true, checked_at: '2026-10-20T00:00:00Z' },
  drift: [{ field: 'bio', desired: 'The wanted bio', actual: 'An old bio' }],
}
const instagram: ChannelProfileView = {
  ...base,
  channel: 'instagram',
  desired: { display_name: 'LifeKeel', handle: 'lifekeel', bio: 'An Instagram bio', link: 'https://lifekeel.co.uk/?utm_source=instagram' },
  desired_hash: 'def456',
  supports_check: false,
  supports_apply: false,
  bio_limit: 150,
}

const apply = vi.fn(async () => ({ ...bluesky, drift: [], applied_at: '2026-10-20T01:00:00Z' }))
vi.mock('@/lib/api', async () => ({
  fetchChannelProfiles: async () => [bluesky, instagram],
  saveChannelProfile: vi.fn(),
  tickProfileStep: vi.fn(),
  checkChannelProfile: vi.fn(),
  applyChannelProfile: (...a: unknown[]) => apply(...(a as [])),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProfilesPanel', () => {
  it('offers a live check only where the network allows it', async () => {
    render(<ProfilesPanel />)
    await screen.findByText('Bluesky')
    expect(screen.getAllByRole('button', { name: 'Check live profile' })).toHaveLength(1)
    expect(screen.getByText('Instagram')).toBeTruthy()
  })

  it('shows drift and only updates after the approver sees the exact text and confirms', async () => {
    render(<ProfilesPanel />)
    await screen.findByText(/Differs from the live profile/)
    expect(screen.getByText(/live shows “An old bio”, wanted “The wanted bio”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Update the live profile/ }))
    expect(screen.getByText(/changes the public profile on Bluesky to exactly/)).toBeTruthy()
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and update' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith('bluesky', 'abc123'))
  })

  it('keeps Save off until the text changes, and blocks an over-length bio', async () => {
    render(<ProfilesPanel />)
    await screen.findByText('Bluesky')
    const save = screen.getAllByRole('button', { name: 'Save' })[1]!
    expect((save as HTMLButtonElement).disabled).toBe(true)
    const bio = screen.getAllByLabelText('Bio')[1]!
    fireEvent.change(bio, { target: { value: 'x'.repeat(151) } })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(bio, { target: { value: 'Short and fine' } })
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })
})
