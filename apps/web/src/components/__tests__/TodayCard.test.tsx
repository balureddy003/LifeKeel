import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TodayCard } from '../TodayCard'

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
    const { container } = render(
      <TodayCard insights={[]} profileCompleteness={0} hasLiveData={false} />,
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
  })
})
