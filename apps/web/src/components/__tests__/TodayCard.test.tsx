import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TodayCard } from '../TodayCard'

const auth = vi.hoisted(() => ({
  family: { members: [{ id: 'me' }] } as { members: { id: string }[] } | null,
}))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth }))

const getObligationsMap = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getObligationsMap: () => getObligationsMap(),
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

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
})
