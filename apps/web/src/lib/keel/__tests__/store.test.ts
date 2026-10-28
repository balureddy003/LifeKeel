import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeelEvent, SetupState } from '../types'

const streamTurn = vi.fn()
const fetchSetupState = vi.fn()
vi.mock('../client', () => ({
  streamTurn: (...a: unknown[]) => streamTurn(...a),
  fetchSetupState: (...a: unknown[]) => fetchSetupState(...a),
  loadThread: vi.fn(),
}))
let curtainGate: Promise<void> | null = null
vi.mock('../../onDeviceLlm', () => ({
  redactForCloudEgressAsync: async (t: string) => {
    if (curtainGate) await curtainGate
    return {
      redactedText: t.replace('jane@x.test', '[EMAIL]'),
      restore: (x: string) => x.replace('[EMAIL]', 'jane@x.test'),
      hasSpecialCategoryHint: false,
    }
  },
}))
vi.mock('../../on-device-ner', () => ({ classifyEntities: vi.fn() }))

import { completionNote, useKeelPanel } from '../store'

const reset = () => {
  curtainGate = null
  useKeelPanel.getState().resetIdentity(null)
  useKeelPanel.setState({
    identity: 'u1',
    identityGen: 1,
    open: false,
    minimised: false,
    greeted: false,
  })
  streamTurn.mockReset()
  fetchSetupState.mockReset()
}

const setup = (over: Partial<SetupState> = {}): SetupState => ({
  bootstrap: false,
  role: 'organizer',
  completed: 1,
  total: 3,
  verified_complete: false,
  next_step_id: 'b',
  data_as_of: '2026-10-28T10:00:00Z',
  steps: [
    {
      id: 'a',
      title: 'Create your household',
      status: 'done',
      route_key: 'family',
      est_minutes: 2,
      can_act: true,
    },
    {
      id: 'b',
      title: 'Record income',
      status: 'not_started',
      route_key: 'financial-profile.income',
      est_minutes: 3,
      can_act: true,
    },
    {
      id: 'c',
      title: 'Add children',
      status: 'not_started',
      route_key: 'family',
      est_minutes: 3,
      can_act: true,
    },
  ],
  ...over,
})

beforeEach(reset)

describe('sending', () => {
  it('streams events into the reply and records the thread id', async () => {
    streamTurn.mockImplementation(async (_r: unknown, onEvent: (e: KeelEvent) => void) => {
      onEvent({ type: 'card', card: { kind: 'navigate', route_key: 'family', label: 'Open' } })
      onEvent({ type: 'text', content: 'Hello' })
      onEvent({ type: 'done', route: 'setup', is_live: false, thread_id: 'thread-1' })
    })
    await useKeelPanel.getState().send('  Where do I start?  ')
    const s = useKeelPanel.getState()
    expect(s.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Where do I start?'],
      ['keel', 'Hello'],
    ])
    expect(s.messages[1]).toMatchObject({
      route: 'setup',
      pending: false,
      cards: [{ kind: 'navigate' }],
    })
    expect(s.threadId).toBe('thread-1')
    expect(s.sending).toBe(false)
  })

  it('the PII curtain redacts what leaves the device and restores the reply', async () => {
    streamTurn.mockImplementation(
      async (r: { message: string }, onEvent: (e: KeelEvent) => void) => {
        expect(r.message).toBe('Email [EMAIL] please')
        onEvent({ type: 'text', content: 'Sent to [EMAIL]' })
        onEvent({ type: 'done', route: 'llm', is_live: true })
      },
    )
    await useKeelPanel.getState().send('Email jane@x.test please')
    expect(useKeelPanel.getState().messages[1]!.content).toBe('Sent to jane@x.test')
  })

  it('an emergency message gets the safety reply on the device and never touches the network', async () => {
    await useKeelPanel.getState().send('I have chest pain')
    expect(streamTurn).not.toHaveBeenCalled()
    expect(useKeelPanel.getState().messages[1]).toMatchObject({
      route: 'emergency',
      pending: false,
    })
    expect(useKeelPanel.getState().messages[1]!.content).toMatch(/999|911|emergency/i)
  })

  it('ignores a second send and blank input while a reply is pending', async () => {
    let release!: () => void
    streamTurn.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const first = useKeelPanel.getState().send('one')
    await vi.waitFor(() => expect(streamTurn).toHaveBeenCalled())
    await useKeelPanel.getState().send('two')
    await useKeelPanel.getState().send('   ')
    expect(streamTurn).toHaveBeenCalledOnce()
    release()
    await first
  })

  it('an error keeps the question for retry; retry replaces the failed exchange', async () => {
    streamTurn.mockImplementationOnce(async (_r: unknown, onEvent: (e: KeelEvent) => void) => {
      onEvent({ type: 'error', code: 'unavailable' })
      onEvent({ type: 'done', route: 'fallback', is_live: false })
    })
    await useKeelPanel.getState().send('What is my cover?')
    const failed = useKeelPanel.getState().messages[1]!
    expect(failed).toMatchObject({ error: 'unavailable', retryOf: 'What is my cover?' })

    streamTurn.mockImplementationOnce(async (_r: unknown, onEvent: (e: KeelEvent) => void) => {
      onEvent({ type: 'text', content: 'Answer' })
      onEvent({ type: 'done', route: 'llm', is_live: true })
    })
    await useKeelPanel.getState().retry(failed.id)
    expect(useKeelPanel.getState().messages.map((m) => m.content)).toEqual([
      'What is my cover?',
      'Answer',
    ])
  })
})

describe('stopping', () => {
  it('Stop pressed while the PII curtain is still running sends nothing', async () => {
    let open!: () => void
    curtainGate = new Promise<void>((r) => (open = r))
    const pending = useKeelPanel.getState().send('hello')
    await vi.waitFor(() => expect(useKeelPanel.getState().sending).toBe(true))
    useKeelPanel.getState().stop()
    open()
    await pending
    expect(streamTurn).not.toHaveBeenCalled()
    expect(useKeelPanel.getState().sending).toBe(false)
  })

  it('a stopped send does not clear a newer send that started afterwards', async () => {
    let open!: () => void
    curtainGate = new Promise<void>((r) => (open = r))
    const first = useKeelPanel.getState().send('first')
    await vi.waitFor(() => expect(useKeelPanel.getState().sending).toBe(true))
    useKeelPanel.getState().stop()
    curtainGate = null
    streamTurn.mockImplementation(() => new Promise<void>(() => {}))
    void useKeelPanel.getState().send('second')
    await vi.waitFor(() => expect(streamTurn).toHaveBeenCalledOnce())
    open()
    await first
    expect(useKeelPanel.getState().sending).toBe(true)
  })
})

describe('identity', () => {
  it('a late event from the previous identity never renders for the next one', async () => {
    let deliver!: (e: KeelEvent) => void
    let release!: () => void
    streamTurn.mockImplementation(
      (_r: unknown, onEvent: (e: KeelEvent) => void) =>
        new Promise<void>((resolve) => {
          deliver = onEvent
          release = resolve
        }),
    )
    const pending = useKeelPanel.getState().send('Show my insurance')
    await vi.waitFor(() => expect(streamTurn).toHaveBeenCalled())

    useKeelPanel.getState().resetIdentity('u2') // sign out, someone else signs in
    expect(useKeelPanel.getState().messages).toEqual([])

    deliver({ type: 'text', content: 'PREVIOUS USER PRIVATE ANSWER' })
    deliver({ type: 'done', route: 'llm', is_live: true, thread_id: 'old-thread' })
    release()
    await pending
    const s = useKeelPanel.getState()
    expect(JSON.stringify(s.messages)).not.toContain('PREVIOUS USER')
    expect(s.threadId).toBeNull()
    expect(s.identity).toBe('u2')
  })

  it('sign-out aborts the in-flight request, clears everything and closes the panel', async () => {
    let signal!: AbortSignal
    streamTurn.mockImplementation((r: { signal: AbortSignal }) => {
      signal = r.signal
      return new Promise<void>(() => {})
    })
    useKeelPanel.setState({ open: true, setup: setup(), draft: 'half typed' })
    void useKeelPanel.getState().send('hello')
    await vi.waitFor(() => expect(streamTurn).toHaveBeenCalled())
    useKeelPanel.getState().resetIdentity(null)
    const s = useKeelPanel.getState()
    expect(signal.aborted).toBe(true)
    expect(s).toMatchObject({
      messages: [],
      setup: null,
      draft: '',
      open: false,
      sending: false,
      threadId: null,
    })
  })

  it('"New conversation" starts clean and cancels the pending request', async () => {
    let signal!: AbortSignal
    streamTurn.mockImplementation((r: { signal: AbortSignal }) => {
      signal = r.signal
      return new Promise<void>(() => {})
    })
    void useKeelPanel.getState().send('hello')
    await vi.waitFor(() => expect(streamTurn).toHaveBeenCalled())
    useKeelPanel.getState().newConversation()
    expect(signal.aborted).toBe(true)
    expect(useKeelPanel.getState()).toMatchObject({ messages: [], sending: false, threadId: null })
  })

  it('resetting to the same identity keeps the conversation', () => {
    useKeelPanel.setState({ messages: [{ id: 'x', role: 'user', content: 'hi', cards: [] }] })
    useKeelPanel.getState().resetIdentity('u1')
    expect(useKeelPanel.getState().messages).toHaveLength(1)
  })
})

describe('browser storage', () => {
  it('persists layout only; conversation text is never written', async () => {
    streamTurn.mockImplementation(async (_r: unknown, onEvent: (e: KeelEvent) => void) => {
      onEvent({ type: 'text', content: 'SECRET ANSWER' })
      onEvent({ type: 'done', route: 'llm', is_live: true })
    })
    useKeelPanel.getState().openPanel()
    await useKeelPanel.getState().send('SECRET QUESTION')
    const stored = sessionStorage.getItem('keel-panel') ?? ''
    expect(stored).toContain('"open":true')
    expect(stored).not.toContain('SECRET')
    expect(Object.keys(JSON.parse(stored).state).sort()).toEqual(['greeted', 'open', 'widthPx'])
    expect(localStorage.getItem('keel-panel')).toBeNull()
  })

  it('clamps the panel width', () => {
    useKeelPanel.getState().setWidth(100)
    expect(useKeelPanel.getState().widthPx).toBe(360)
    useKeelPanel.getState().setWidth(2000)
    expect(useKeelPanel.getState().widthPx).toBe(560)
  })
})

describe('setup refresh and completion notes', () => {
  it('a step that flips to done produces a local note naming the next step', async () => {
    const before = setup()
    const after = setup({
      completed: 2,
      next_step_id: 'c',
      steps: before.steps.map((s) => (s.id === 'b' ? { ...s, status: 'done' as const } : s)),
    })
    useKeelPanel.setState({ setup: before })
    fetchSetupState.mockResolvedValue(after)
    await useKeelPanel.getState().refreshSetup()
    const note = useKeelPanel.getState().messages.at(-1)!
    expect(note.content).toContain('Record income')
    expect(note.content).toContain('**2 of 3**')
    expect(note.content).toContain('Add children')
    expect(note.cards[0]).toMatchObject({ kind: 'navigate', route_key: 'family' })
  })

  it('no note when nothing changed or on the first read', () => {
    expect(completionNote(null, setup())).toBeNull()
    expect(completionNote(setup(), setup())).toBeNull()
  })

  it('a failed refresh keeps the last good state and flags it', async () => {
    useKeelPanel.setState({ setup: setup() })
    fetchSetupState.mockResolvedValue(null)
    await useKeelPanel.getState().refreshSetup()
    expect(useKeelPanel.getState()).toMatchObject({ setupFailed: true, setupLoading: false })
    expect(useKeelPanel.getState().setup?.completed).toBe(1)
  })

  it('a setup read that returns after a sign-out is discarded', async () => {
    let resolve!: (s: SetupState) => void
    fetchSetupState.mockImplementation(() => new Promise<SetupState>((r) => (resolve = r)))
    const refresh = useKeelPanel.getState().refreshSetup()
    useKeelPanel.getState().resetIdentity('u2')
    resolve(setup())
    await refresh
    expect(useKeelPanel.getState().setup).toBeNull()
  })
})
