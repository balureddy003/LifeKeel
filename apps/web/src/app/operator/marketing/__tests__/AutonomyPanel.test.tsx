import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BankEntry, StandingStatus } from '@/lib/api'

const fetchStanding = vi.fn()
const fetchBank = vi.fn()
const approveBankEntries = vi.fn()
const saveStandingPolicy = vi.fn()
const disableStanding = vi.fn()
const resumeStandingChannel = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchStanding: () => fetchStanding(),
  fetchBank: (s: string) => fetchBank(s),
  approveBankEntries: (i: unknown) => approveBankEntries(i),
  saveStandingPolicy: (i: unknown) => saveStandingPolicy(i),
  disableStanding: (r: string) => disableStanding(r),
  resumeStandingChannel: (c: string) => resumeStandingChannel(c),
  retireBankEntry: vi.fn(),
  editBankEntry: vi.fn(),
  runStandingNow: vi.fn(),
}))
const toast = vi.fn()
vi.mock('@/components/Toast', () => ({ useToast: () => toast }))

import { AutonomyPanel } from '../_components/AutonomyPanel'

const entry = (over: Partial<BankEntry>): BankEntry => ({
  id: 'e1',
  content: 'Where does your family stand? Free to start. {{link}}',
  content_hash: 'h1',
  channels: ['bluesky'],
  format: 'myth_vs_file',
  hook: 'question',
  pillar: 'chart',
  status: 'candidate',
  source: 'candidate_job',
  card: null,
  media_url: null,
  link_path: '/guides/chart',
  copy_check: { ok: true, violations: [] },
  missing_image_for: [],
  approved_by: null,
  approved_at: null,
  expires_at: null,
  times_scheduled: 0,
  retired_reason: null,
  created_at: '2026-10-20T08:00:00Z',
  ...over,
})

const idle: StandingStatus = {
  policy: null,
  active: false,
  bank: { candidate: 2, approved: 0, retired: 0 },
  weeks_of_posts_left: null,
  upcoming: [],
}

beforeEach(() => {
  fetchStanding.mockResolvedValue(idle)
  fetchBank.mockImplementation(async (s: string) =>
    s === 'candidate'
      ? [
          entry({ id: 'ok' }),
          entry({
            id: 'bad',
            content_hash: 'h2',
            copy_check: { ok: false, violations: [{ rule: 'x', match: 'y' }] },
          }),
        ]
      : [],
  )
  approveBankEntries.mockResolvedValue({
    results: [{ id: 'ok', ok: true }],
    approved: 1,
    refused: 0,
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AutonomyPanel', () => {
  it('says plainly that nothing is automatic until it is turned on', async () => {
    render(<AutonomyPanel />)
    expect(await screen.findByText(/Not active/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Turn on' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('approves a candidate by the hash it showed, and blocks one that fails the copy guard', async () => {
    render(<AutonomyPanel />)
    const approve = await screen.findAllByRole('button', { name: 'Approve this text' })
    expect(approve).toHaveLength(2)
    expect((approve[1] as HTMLButtonElement).disabled).toBe(true) // the copy-guard failure
    fireEvent.click(approve[0]!)
    await waitFor(() =>
      expect(approveBankEntries).toHaveBeenCalledWith([{ id: 'ok', content_hash: 'h1' }]),
    )
  })

  it('turning on needs networks and a reason, and sends the limits', async () => {
    saveStandingPolicy.mockResolvedValue({ policy: {} })
    render(<AutonomyPanel />)
    const turnOn = await screen.findByRole('button', { name: 'Turn on' })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'weekly programme' } })
    expect((turnOn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(turnOn)
    await waitFor(() =>
      expect(saveStandingPolicy).toHaveBeenCalledWith({
        reason: 'weekly programme',
        expires_in_days: 30,
        channels: ['bluesky'],
        max_per_channel_per_week: 3,
      }),
    )
  })

  it('shows a paused network with a resume button, and a stop button when active', async () => {
    fetchStanding.mockResolvedValue({
      ...idle,
      active: true,
      policy: {
        enabled: true,
        enabled_by: 'me',
        enabled_at: '2026-10-20T08:00:00Z',
        reason: 'r',
        expires_at: '2026-11-19T08:00:00Z',
        channels: ['bluesky', 'x'],
        max_per_channel_per_week: 3,
        max_per_channel_per_day: 1,
        min_gap_hours: 24,
        repeat_cooldown_days: 45,
        hours: [9],
        paused_channels: [
          { channel: 'x', reason: '2 publish failures in a row', at: '2026-10-21T08:00:00Z' },
        ],
      },
    })
    resumeStandingChannel.mockResolvedValue({ ok: true })
    disableStanding.mockResolvedValue({ rejected: 3 })
    render(<AutonomyPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume x' }))
    await waitFor(() => expect(resumeStandingChannel).toHaveBeenCalledWith('x'))
    fireEvent.click(screen.getByRole('button', { name: 'Stop posting' }))
    await waitFor(() => expect(disableStanding).toHaveBeenCalled())
  })
})
