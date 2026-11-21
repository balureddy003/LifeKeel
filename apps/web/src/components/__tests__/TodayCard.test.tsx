import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act } from '@testing-library/react'
import { SEEN_CONFIRMED_EVENT } from '@/lib/seen-status'
import { TodayCard } from '../TodayCard'

const auth = vi.hoisted(() => ({
  family: { members: [{ id: 'me' }] } as { members: { id: string }[] } | null,
}))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth }))

const getObligationsMap = vi.fn()
const getDomains = vi.fn()
const getDomainView = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getObligationsMap: () => getObligationsMap(),
  getDomains: () => getDomains(),
  getDomainView: (id: string) => getDomainView(id),
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

beforeEach(() => {
  getDomains.mockResolvedValue({ domains: [] })
  getDomainView.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TodayCard', () => {
  it('shows one item, why it is first, and one link', async () => {
    getObligationsMap.mockResolvedValue({ obligations: [] })
    render(<TodayCard insights={[]} profileCompleteness={50} hasLiveData />)
    expect(await screen.findByText('One thing worth checking today')).toBeTruthy()
    expect(screen.getByText(/Why this one/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Add it/ }).getAttribute('href')).toBe(
      '/financial-profile',
    )
  })

  it('says nothing needs checking once the account has data and someone else is on it', async () => {
    auth.family = { members: [{ id: 'me' }, { id: 'tom' }] }
    getObligationsMap.mockResolvedValue({ obligations: [] })
    render(<TodayCard insights={[]} profileCompleteness={100} hasLiveData />)
    expect(await screen.findByText('Nothing needs checking today.')).toBeTruthy()
    expect(screen.queryByText('Start here')).toBeNull()
    auth.family = { members: [{ id: 'me' }] }
  })

  it('starts a brand-new household with one policy, labelled Start here', async () => {
    auth.family = { members: [{ id: 'me' }] }
    getObligationsMap.mockResolvedValue({ obligations: [] })
    render(<TodayCard insights={[]} profileCompleteness={0} hasLiveData={false} />)
    expect(await screen.findByText('Start here')).toBeTruthy()
    expect(screen.getByText('Check one policy')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Add a policy/ }).getAttribute('href')).toBe(
      '/policies/new',
    )
    expect(screen.queryByText('One thing worth checking today')).toBeNull()
  })

  it('asks a new household with a partner for one policy too', async () => {
    auth.family = { members: [{ id: 'me' }, { id: 'tom' }] }
    getObligationsMap.mockResolvedValue({ obligations: [] })
    render(<TodayCard insights={[]} profileCompleteness={0} hasLiveData={false} />)
    expect(await screen.findByText('Check one policy')).toBeTruthy()
    auth.family = { members: [{ id: 'me' }] }
  })

  it('once something is on file and no one else is on the list, asks for the other adult', async () => {
    auth.family = { members: [{ id: 'me' }] }
    getObligationsMap.mockResolvedValue({ obligations: [] })
    render(<TodayCard insights={[]} profileCompleteness={100} hasLiveData />)
    expect(await screen.findByText('Add the other adult')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Add them/ }).getAttribute('href')).toBe(
      '/settings?add=1',
    )
  })

  it('points at a list the viewer has not confirmed, so the partner is not told nothing needs checking', async () => {
    getObligationsMap.mockResolvedValue({ obligations: [] })
    getDomains.mockResolvedValue({
      domains: [{ id: 'life_protection', title: 'Life and income protection' }],
    })
    getDomainView.mockResolvedValue({
      rows: [{}],
      result_version: 'v1',
      confirmation: {
        required: [
          { id: 'a', name: 'Priya' },
          { id: 'b', name: 'Tom' },
        ],
        confirmed: [{ id: 'a', name: 'Priya', confirmed_at: '2026-11-20T10:00:00Z' }],
        both_confirmed: false,
        viewer_confirmed: false,
      },
    })
    render(<TodayCard insights={[]} profileCompleteness={100} hasLiveData />)
    expect(await screen.findByText('Look at Life and income protection and confirm')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Look and confirm/ }).getAttribute('href')).toBe(
      '#seen-life_protection',
    )
    expect(screen.queryByText('Nothing needs checking today.')).toBeNull()
  })

  it('jumps to the row on Home, and drops the ask once that list is confirmed', async () => {
    getObligationsMap.mockResolvedValue({ obligations: [] })
    getDomains.mockResolvedValue({
      domains: [{ id: 'life_protection', title: 'Life and income protection' }],
    })
    const view = (viewer: boolean) => ({
      rows: [{}],
      result_version: 'v1',
      confirmation: {
        required: [{ id: 'a', name: 'Priya' }],
        confirmed: viewer ? [{ id: 'a', name: 'Priya', confirmed_at: '2026-11-20T10:00:00Z' }] : [],
        both_confirmed: viewer,
        viewer_confirmed: viewer,
      },
    })
    getDomainView.mockResolvedValue(view(false))
    render(<TodayCard insights={[]} profileCompleteness={100} hasLiveData />)
    const link = await screen.findByRole('link', { name: /Look and confirm/ })
    expect(link.getAttribute('href')).toBe('#seen-life_protection')
    getDomainView.mockResolvedValue(view(true))
    await act(async () => {
      window.dispatchEvent(new Event(SEEN_CONFIRMED_EVENT))
    })
    await waitFor(() => expect(screen.queryByText(/and confirm$/)).toBeNull())
  })
})
