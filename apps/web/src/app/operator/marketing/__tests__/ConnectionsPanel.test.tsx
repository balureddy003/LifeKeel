import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ChannelHealth } from '@/lib/api'

const fetchChannelHealth = vi.fn()
const startConnectorConnect = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchChannelHealth: () => fetchChannelHealth(),
  startConnectorConnect: (id: string) => startConnectorConnect(id),
}))
const toast = vi.fn()
vi.mock('@/components/Toast', () => ({ useToast: () => toast }))

import { ConnectionsPanel } from '../_components/ConnectionsPanel'

const base = (
  over: Partial<ChannelHealth> & Pick<ChannelHealth, 'channel' | 'label'>,
): ChannelHealth => ({
  status: 'not_configured',
  usable: false,
  handle: null,
  expires_at: null,
  last_publish_at: null,
  last_error: null,
  app_credentials: true,
  setup: {
    portal: 'https://example.com/portal',
    steps: ['Create an app', 'Add the redirect address'],
    redirect_uri: 'https://api.example.com/connectors/x/oauth/callback',
    env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    note: 'A note.',
  },
  ...over,
})

const channels: ChannelHealth[] = [
  base({
    channel: 'bluesky',
    label: 'Bluesky',
    status: 'connected',
    usable: true,
    handle: 'keel.bsky.social',
    last_publish_at: '2026-10-20T09:00:00Z',
    setup: {
      portal: 'https://bsky.app',
      steps: ['Create an app password'],
      redirect_uri: null,
      env: [],
    },
  }),
  base({ channel: 'x', label: 'X', status: 'not_configured', app_credentials: true }),
  base({
    channel: 'linkedin',
    label: 'LinkedIn',
    status: 'expiring_soon',
    usable: true,
    handle: 'Founder',
    expires_at: '2026-10-27T00:00:00Z',
  }),
  base({
    channel: 'threads',
    label: 'Threads',
    status: 'needs_reauth',
    last_error: 'threads token expired — reconnect',
  }),
  base({
    channel: 'facebook',
    label: 'Facebook Page',
    status: 'not_configured',
    app_credentials: false,
    setup: {
      portal: 'https://example.com/meta',
      steps: ['Create a Meta app'],
      redirect_uri: 'https://api.example.com/connectors/facebook_pages/oauth/callback',
      env: ['META_CLIENT_ID', 'META_CLIENT_SECRET'],
    },
  }),
  base({
    channel: 'instagram',
    label: 'Instagram',
    status: 'error',
    last_error: 'No Instagram business account',
  }),
]

beforeEach(() => {
  fetchChannelHealth.mockResolvedValue({ channels })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const card = (name: string) =>
  screen.getByRole('heading', { name }).closest('div')!.parentElement!.parentElement!

describe('ConnectionsPanel', () => {
  it('shows every platform with its state and how many are ready', async () => {
    render(<ConnectionsPanel />)
    await screen.findByText(/2 of 6 platforms ready/)
    for (const label of ['Bluesky', 'X', 'LinkedIn', 'Threads', 'Facebook Page', 'Instagram'])
      expect(screen.getByRole('heading', { name: label })).toBeTruthy()
    expect(screen.getByText('connected')).toBeTruthy()
    expect(screen.getByText('expires soon')).toBeTruthy()
    expect(screen.getByText('reconnect needed')).toBeTruthy()
    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getAllByText('not connected')).toHaveLength(2)
  })

  it('shows the last real post, the handle and a token expiry date', async () => {
    render(<ConnectionsPanel />)
    await screen.findByText('keel.bsky.social')
    expect(screen.getByText('20 Oct 2026')).toBeTruthy() // last post on Bluesky
    expect(screen.getByText('27 Oct 2026')).toBeTruthy() // LinkedIn token expiry
    expect(screen.getAllByText('none yet').length).toBeGreaterThan(0)
  })

  it('shows the error that stopped a platform, as an alert', async () => {
    render(<ConnectionsPanel />)
    expect((await screen.findAllByRole('alert')).map((a) => a.textContent)).toEqual(
      expect.arrayContaining([
        'threads token expired — reconnect',
        'No Instagram business account',
      ]),
    )
  })

  it('tells you which developer-app credentials are missing, and blocks Connect until they are set', async () => {
    render(<ConnectionsPanel />)
    await screen.findByText(/Set META_CLIENT_ID and META_CLIENT_SECRET on the API/)
    const fb = card('Facebook Page')
    expect(
      (within(fb).getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    const x = card('X')
    expect((within(x).getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('offers Reconnect (not Connect) for a connection that already exists', async () => {
    render(<ConnectionsPanel />)
    await screen.findByText('LinkedIn')
    expect(within(card('Threads')).getByRole('button', { name: 'Reconnect' })).toBeTruthy()
    expect(within(card('LinkedIn')).getByRole('button', { name: 'Reconnect' })).toBeTruthy()
  })

  it('has no Connect button for Bluesky, which uses an app password', async () => {
    render(<ConnectionsPanel />)
    await screen.findByText('keel.bsky.social')
    expect(within(card('Bluesky')).queryByRole('button')).toBeNull()
  })

  it('starts the OAuth flow for the right connector', async () => {
    startConnectorConnect.mockResolvedValue({ auth_url: undefined })
    render(<ConnectionsPanel />)
    await screen.findByText(/2 of 6/)
    fireEvent.click(within(card('X')).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(startConnectorConnect).toHaveBeenCalledWith('twitter_x'))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })),
    )
  })

  it('shows the setup steps and the exact redirect address for a platform that is not connected', async () => {
    render(<ConnectionsPanel />)
    await screen.findByText(/2 of 6/)
    const x = card('X')
    expect(within(x).getByText('How to connect X')).toBeTruthy()
    expect(within(x).getByText('Create an app')).toBeTruthy()
    expect(within(x).getByText('https://api.example.com/connectors/x/oauth/callback')).toBeTruthy()
    expect(
      within(x)
        .getByRole('link', { name: /developer portal/ })
        .getAttribute('href'),
    ).toBe('https://example.com/portal')
    // A healthy platform needs no instructions.
    expect(within(card('Bluesky')).queryByText(/How to connect/)).toBeNull()
  })

  it('shows a load failure', async () => {
    fetchChannelHealth.mockRejectedValue(new Error('Missing operator permission: marketing.read'))
    render(<ConnectionsPanel />)
    await screen.findByText(/Missing operator permission: marketing.read/)
  })
})
