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

  it('says nothing needs checking once the account has data, and hides for a new account', async () => {
    getObligationsMap.mockResolvedValue({ obligations: [] })
    const { unmount } = render(<TodayCard insights={[]} profileCompleteness={100} hasLiveData />)
    expect(await screen.findByText('Nothing needs checking today.')).toBeTruthy()
    unmount()
    // Hidden for a new account that already has someone else on it; a lone one is asked to add them.
    auth.family = { members: [{ id: 'me' }, { id: 'tom' }] }
    const { container } = render(
      <TodayCard insights={[]} profileCompleteness={0} hasLiveData={false} />,
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
    auth.family = { members: [{ id: 'me' }] }
  })

  it('starts a brand-new household with the other adult, labelled Start here', async () => {
    auth.family = { members: [{ id: 'me' }] }
    getObligationsMap.mockResolvedValue({ obligations: [] })
    render(<TodayCard insights={[]} profileCompleteness={0} hasLiveData={false} />)
    expect(await screen.findByText('Start here')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Add them/ }).getAttribute('href')).toBe(
      '/settings?add=1',
    )
    expect(screen.queryByText('One thing worth checking today')).toBeNull()
  })

  it('stays hidden for a new account that already has someone else on it', async () => {
    auth.family = { members: [{ id: 'me' }, { id: 'tom' }] }
    getObligationsMap.mockResolvedValue({ obligations: [] })
    const { container } = render(
      <TodayCard insights={[]} profileCompleteness={0} hasLiveData={false} />,
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
    auth.family = { members: [{ id: 'me' }] }
  })

  it('does not start with the other adult once the account has data', async () => {
    auth.family = { members: [{ id: 'me' }] }
    getObligationsMap.mockResolvedValue({ obligations: [] })
    render(<TodayCard insights={[]} profileCompleteness={100} hasLiveData />)
    expect(await screen.findByText('Nothing needs checking today.')).toBeTruthy()
    expect(screen.queryByText('Start here')).toBeNull()
  })
})
