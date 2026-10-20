import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const subscribeNativePush = vi.fn()
vi.mock('@/lib/push', () => ({
  subscribeNativePush: () => subscribeNativePush(),
  isPushSupported: () => true,
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import { ChannelsCard } from '../ChannelsCard'
import type { ChannelState } from '@/lib/api'

const base: ChannelState = {
  email: { available: true },
  web_push: { devices: 0, enabled: false },
  mobile_push: { devices: 0, enabled: false, platforms: [] },
  recent_failures: { web_push: 0, mobile_push: 0, last_at: null },
  first_channel: 'email',
}
const facts = { nativeShell: true, ios: true, standalone: false, pushSupported: false }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChannelsCard', () => {
  it('renders nothing when the API gives no state (children, signed out)', async () => {
    const load = vi.fn(async () => null)
    const { container } = render(<ChannelsCard loadState={load} readFacts={() => facts} />)
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('explains the channels and turns native alerts on, then refreshes', async () => {
    const load = vi
      .fn<() => Promise<ChannelState | null>>()
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce({
        ...base,
        mobile_push: { devices: 1, enabled: true, platforms: ['ios'] },
      })
    subscribeNativePush.mockResolvedValue(true)
    render(<ChannelsCard loadState={load} readFacts={() => facts} />)
    expect(await screen.findByText('How alerts reach you')).toBeTruthy()
    expect(screen.getByText(/Email is the safety net/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on alerts' }))
    await waitFor(() => expect(screen.getByText('Alerts are on in this app.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).toBeNull()
  })

  it('says what went wrong when alerts cannot be turned on', async () => {
    subscribeNativePush.mockResolvedValue(false)
    render(<ChannelsCard loadState={async () => base} readFacts={() => facts} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on alerts' }))
    expect(await screen.findByText(/Could not turn alerts on/)).toBeTruthy()
  })

  it('shows the iPhone Home Screen hint in a browser', async () => {
    render(
      <ChannelsCard
        loadState={async () => base}
        readFacts={() => ({
          nativeShell: false,
          ios: true,
          standalone: false,
          pushSupported: true,
        })}
      />,
    )
    expect(await screen.findByText(/Add LifeKeel to your Home Screen/)).toBeTruthy()
  })
})
