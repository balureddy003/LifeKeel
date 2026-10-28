import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { detectEmergency, EMERGENCY_REPLY } from '../emergency-detection'
import { fetchSetupState, loadThread, streamTurn } from './client'
import type { KeelCard, KeelEvent, KeelMessage, PageContext, SetupState } from './types'

export const MIN_WIDTH = 360
export const MAX_WIDTH = 560
export const DEFAULT_WIDTH = 400

export const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)))

interface KeelPanelState {
  open: boolean
  minimised: boolean
  widthPx: number
  greeted: boolean
  /** Who the in-memory conversation belongs to; null when signed out. */
  identity: string | null
  /** Bumped on sign-in, sign-out, account switch and "New conversation". */
  identityGen: number
  messages: KeelMessage[]
  threadId: string | null
  pageContext: PageContext
  draft: string
  sending: boolean
  abort: AbortController | null
  setup: SetupState | null
  setupLoading: boolean
  setupFailed: boolean

  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  setMinimised: (v: boolean) => void
  setWidth: (w: number) => void
  setPageContext: (ctx: Partial<PageContext>) => void
  setDraft: (d: string) => void
  resetIdentity: (identity: string | null) => void
  newConversation: () => void
  stop: () => void
  send: (text: string, opts?: { memberId?: string }) => Promise<void>
  retry: (messageId: string) => Promise<void>
  refreshSetup: () => Promise<void>
  openThread: (id: string) => Promise<void>
  markGreeted: () => void
  appendLocal: (msg: Omit<KeelMessage, 'id'>) => void
}

const safeSession: StateStorage = {
  getItem: (n) => {
    try {
      return sessionStorage.getItem(n)
    } catch {
      return null
    }
  },
  setItem: (n, v) => {
    try {
      sessionStorage.setItem(n, v)
    } catch {
      /* storage blocked: the panel still works, it just forgets its layout */
    }
  },
  removeItem: (n) => {
    try {
      sessionStorage.removeItem(n)
    } catch {
      /* ignore */
    }
  },
}

let counter = 0
const uid = (p: string) => `${p}-${Date.now()}-${++counter}`

/** What changed between two setup reads, as a short local note (no model). */
export function completionNote(
  prev: SetupState | null,
  next: SetupState,
): { content: string; cards: KeelCard[] } | null {
  if (!prev || prev.bootstrap !== next.bootstrap) return null
  const before = new Map(prev.steps.map((s) => [s.id, s.status]))
  const finished = next.steps.filter(
    (s) => s.status === 'done' && before.get(s.id) !== 'done' && before.has(s.id),
  )
  if (finished.length === 0) return null
  const lines = [
    `${finished.map((s) => s.title).join('; ')} — saved. That's **${next.completed} of ${next.total}** done.`,
  ]
  const cards: KeelCard[] = []
  const upNext = next.steps.find((s) => s.id === next.next_step_id)
  if (upNext) {
    lines.push(`**Next:** ${upNext.title} (about ${upNext.est_minutes} min).`)
    cards.push({
      kind: 'navigate',
      route_key: upNext.route_key,
      label: `Open: ${upNext.title}`,
      ...(upNext.anchor ? { anchor: upNext.anchor } : {}),
    })
  } else if (next.verified_complete) {
    lines.push('Everything I can check for your household is set up.')
  }
  return { content: lines.join('\n\n'), cards }
}

export const useKeelPanel = create<KeelPanelState>()(
  persist(
    (set, get) => ({
      open: false,
      minimised: false,
      widthPx: DEFAULT_WIDTH,
      greeted: false,
      identity: null,
      identityGen: 0,
      messages: [],
      threadId: null,
      pageContext: { route: '/', anchors: [] },
      draft: '',
      sending: false,
      abort: null,
      setup: null,
      setupLoading: false,
      setupFailed: false,

      openPanel: () => set({ open: true, minimised: false }),
      closePanel: () => set({ open: false }),
      togglePanel: () => set((s) => ({ open: !s.open, minimised: false })),
      setMinimised: (minimised) => set({ minimised }),
      setWidth: (w) => set({ widthPx: clampWidth(w) }),
      setPageContext: (ctx) => set((s) => ({ pageContext: { ...s.pageContext, ...ctx } })),
      setDraft: (draft) => set({ draft }),
      markGreeted: () => set({ greeted: true }),

      appendLocal: (msg) => set((s) => ({ messages: [...s.messages, { ...msg, id: uid('k') }] })),

      resetIdentity: (identity) => {
        const s = get()
        if (s.identity === identity) return
        s.abort?.abort()
        set({
          identity,
          identityGen: s.identityGen + 1,
          messages: [],
          threadId: null,
          draft: '',
          sending: false,
          abort: null,
          setup: null,
          setupLoading: false,
          setupFailed: false,
          greeted: false,
          open: identity === null ? false : s.open,
        })
      },

      newConversation: () => {
        const s = get()
        s.abort?.abort()
        set({
          identityGen: s.identityGen + 1,
          messages: [],
          threadId: null,
          sending: false,
          abort: null,
          draft: '',
        })
      },

      stop: () => {
        const s = get()
        s.abort?.abort()
        set({
          sending: false,
          abort: null,
          messages: s.messages.filter((m) => !m.pending),
        })
      },

      send: async (text, opts) => {
        const message = text.trim()
        const s0 = get()
        if (!message || s0.sending) return

        const gen = s0.identityGen
        const controller = new AbortController()
        const userMsg: KeelMessage = { id: uid('u'), role: 'user', content: message, cards: [] }
        const replyId = uid('k')
        set({
          messages: [
            ...s0.messages,
            userMsg,
            { id: replyId, role: 'keel', content: '', cards: [], pending: true },
          ],
          sending: true,
          abort: controller,
          draft: '',
        })

        const patch = (fn: (m: KeelMessage) => KeelMessage) =>
          set((s) => ({ messages: s.messages.map((m) => (m.id === replyId ? fn(m) : m)) }))
        // Only clear what this send set; a newer send (or Stop) owns the state otherwise.
        const finish = () => {
          if (get().identityGen === gen && get().abort === controller)
            set({ sending: false, abort: null })
        }

        // Safety first, on the device: works offline and while the assistant is down.
        const emergency = detectEmergency(message)
        if (emergency) {
          patch((m) => ({
            ...m,
            content: EMERGENCY_REPLY[emergency],
            route: 'emergency',
            pending: false,
          }))
          finish()
          return
        }

        // The reversible PII curtain runs before anything leaves the device.
        const { redactForCloudEgressAsync } = await import('../onDeviceLlm')
        const { classifyEntities } = await import('../on-device-ner')
        const curtain = await redactForCloudEgressAsync(
          message,
          { memberNames: [] },
          { classify: classifyEntities },
        )
        // Stop or sign-out may have happened while the curtain ran; send nothing in that case.
        if (controller.signal.aborted || get().identityGen !== gen) return

        const onEvent = (e: KeelEvent) => {
          if (get().identityGen !== gen) return // a late event from a previous identity
          switch (e.type) {
            case 'card':
              patch((m) => ({ ...m, cards: [...m.cards, e.card] }))
              break
            case 'text':
              patch((m) => ({ ...m, content: curtain.restore(e.content) }))
              break
            case 'provenance':
              patch((m) => ({ ...m, dataAsOf: e.data_as_of }))
              break
            case 'error':
              patch((m) => ({ ...m, error: e.code, retryOf: message, pending: false }))
              break
            case 'done':
              patch((m) => ({ ...m, route: e.route, isLive: e.is_live, pending: false }))
              if (e.thread_id) set({ threadId: e.thread_id })
              break
            case 'status':
              break
          }
        }

        await streamTurn(
          {
            message: curtain.redactedText,
            threadId: get().threadId,
            pageContext: get().pageContext,
            ...(opts?.memberId ? { memberId: opts.memberId } : {}),
            ...(curtain.hasSpecialCategoryHint ? { medicalHint: true } : {}),
            signal: controller.signal,
          },
          onEvent,
        )
        finish()
      },

      retry: async (messageId) => {
        const s = get()
        const idx = s.messages.findIndex((m) => m.id === messageId)
        const question = s.messages[idx]?.retryOf
        if (idx < 0 || !question || s.sending) return
        // Drop the failed reply and its question, then ask again.
        set({ messages: s.messages.filter((_, i) => i !== idx && i !== idx - 1) })
        await get().send(question)
      },

      refreshSetup: async () => {
        const gen = get().identityGen
        set({ setupLoading: true })
        const next = await fetchSetupState()
        if (get().identityGen !== gen) return
        const prev = get().setup
        set({ setup: next ?? prev, setupFailed: next === null, setupLoading: false })
        if (next) {
          const note = completionNote(prev, next)
          if (note)
            get().appendLocal({
              role: 'keel',
              content: note.content,
              cards: note.cards,
              route: 'setup',
            })
        }
      },

      openThread: async (id) => {
        const gen = get().identityGen
        const stored = await loadThread(id)
        if (!stored || get().identityGen !== gen) return
        get().abort?.abort()
        set({ identityGen: gen + 1, messages: stored, threadId: id, sending: false, abort: null })
      },
    }),
    {
      name: 'keel-panel',
      storage: createJSONStorage(() => safeSession),
      // Layout only. Conversation text is never written to browser storage.
      partialize: (s) => ({ open: s.open, widthPx: s.widthPx, greeted: s.greeted }),
    },
  ),
)
