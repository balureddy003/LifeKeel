import { credFetch } from '../http'
import { getApiBase } from '../env'
import { getSessionToken } from '../session-token'
import type {
  KeelEvent,
  KeelMessage,
  PageContext,
  SetupState,
  ThreadSummary,
  KeelCard,
  KeelRoute,
} from './types'

/**
 * Off in production until NEXT_PUBLIC_KEEL_PANEL=on; on by default in dev
 * and tests unless set to "off". Off brings back the full-page /assistant.
 */
export function isKeelPanelEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_KEEL_PANEL
  if (flag === 'on') return true
  if (flag === 'off') return false
  return process.env.NODE_ENV !== 'production'
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  const token = getSessionToken()
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

const url = (path: string) => `${getApiBase()}${path}`
const TURN_TIMEOUT_MS = 45_000

export interface TurnRequest {
  message: string
  threadId: string | null
  pageContext: PageContext
  memberId?: string
  medicalHint?: boolean
  signal: AbortSignal
}

/** Parse one SSE block ("event: keel\ndata: {...}") into an event. */
export function parseSseBlock(block: string): KeelEvent | null {
  const data = block
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6))
    .join('\n')
  if (!data) return null
  try {
    return JSON.parse(data) as KeelEvent
  } catch {
    return null
  }
}

function errorFor(status: number): KeelEvent {
  if (status === 401) return { type: 'error', code: 'signed_out' }
  if (status === 429) return { type: 'error', code: 'rate_limited' }
  return { type: 'error', code: 'unavailable' }
}

/**
 * One streamed turn. Uses fetch + a stream reader rather than EventSource,
 * which cannot POST or send headers (and a token in a URL would leak into logs).
 * Always ends by emitting a `done` event, so the caller can rely on it.
 */
export async function streamTurn(req: TurnRequest, onEvent: (e: KeelEvent) => void): Promise<void> {
  if (req.signal.aborted) return
  let finished = false
  const emit = (e: KeelEvent) => {
    if (e.type === 'done') finished = true
    onEvent(e)
  }
  // AbortSignal.any / .timeout are missing from older Safari, so combine them by hand.
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  req.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS)
  const signal = controller.signal

  try {
    const res = await credFetch(url('/keel/turns'), {
      method: 'POST',
      headers: headers({ Accept: 'text/event-stream' }),
      body: JSON.stringify({
        message: req.message,
        ...(req.threadId ? { thread_id: req.threadId } : {}),
        page_context: {
          route: req.pageContext.route,
          ...(req.pageContext.step ? { step: req.pageContext.step } : {}),
          anchors: req.pageContext.anchors.slice(0, 50),
        },
        ...(req.memberId ? { member_id: req.memberId } : {}),
        ...(req.medicalHint ? { medical_hint: true } : {}),
      }),
      signal,
    })
    if (!res.ok) {
      emit(errorFor(res.status))
    } else if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let i: number
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const event = parseSseBlock(buffer.slice(0, i))
          buffer = buffer.slice(i + 2)
          if (event) emit(event)
        }
      }
    } else {
      const body = (await res.json()) as { events?: KeelEvent[] }
      for (const e of body.events ?? []) emit(e)
    }
  } catch {
    // Aborts (sign-out, new chat, Stop) are intentional and stay silent.
    if (!req.signal.aborted) emit({ type: 'error', code: 'unavailable' })
  }
  clearTimeout(timer)
  req.signal.removeEventListener('abort', onAbort)
  if (!finished && !req.signal.aborted) emit({ type: 'done', route: 'fallback', is_live: false })
}

export async function fetchSetupState(signal?: AbortSignal): Promise<SetupState | null> {
  try {
    const res = await credFetch(url('/keel/setup-state'), {
      headers: headers(),
      ...(signal ? { signal } : {}),
    })
    return res.ok ? ((await res.json()) as SetupState) : null
  } catch {
    return null
  }
}

async function post(path: string): Promise<Response | null> {
  try {
    return await credFetch(url(path), { method: 'POST', headers: headers() })
  } catch {
    return null
  }
}

export type ProposalOutcome = 'applied' | 'conflict' | 'forbidden' | 'gone' | 'failed'

export async function confirmProposal(id: string): Promise<ProposalOutcome> {
  const res = await post(`/keel/proposals/${encodeURIComponent(id)}/confirm`)
  if (!res) return 'failed'
  if (res.ok) return 'applied'
  if (res.status === 409) return 'conflict'
  if (res.status === 403) return 'forbidden'
  if (res.status === 404) return 'gone'
  return 'failed'
}

export async function dismissProposal(id: string): Promise<boolean> {
  return (await post(`/keel/proposals/${encodeURIComponent(id)}/dismiss`))?.ok === true
}

export async function skipStep(id: string): Promise<boolean> {
  return (await post(`/keel/steps/${encodeURIComponent(id)}/skip`))?.ok === true
}

export async function listThreads(): Promise<ThreadSummary[]> {
  try {
    const res = await credFetch(url('/keel/threads'), { headers: headers() })
    return res.ok ? ((await res.json()) as { threads: ThreadSummary[] }).threads : []
  } catch {
    return []
  }
}

interface StoredMessage {
  id: string
  author: 'user' | 'keel'
  content: string
  answer_route?: KeelRoute
  cards?: KeelCard[]
  data_as_of?: string
}

export async function loadThread(id: string): Promise<KeelMessage[] | null> {
  try {
    const res = await credFetch(url(`/keel/threads/${encodeURIComponent(id)}`), {
      headers: headers(),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { messages: StoredMessage[] }
    return body.messages.map((m) => ({
      id: m.id,
      role: m.author,
      content: m.content,
      cards: m.cards ?? [],
      ...(m.answer_route ? { route: m.answer_route } : {}),
      ...(m.data_as_of ? { dataAsOf: m.data_as_of } : {}),
    }))
  } catch {
    return null
  }
}

async function del(path: string): Promise<boolean> {
  try {
    return (await credFetch(url(path), { method: 'DELETE', headers: headers() })).ok
  } catch {
    return false
  }
}

export const deleteThread = (id: string) => del(`/keel/threads/${encodeURIComponent(id)}`)
export const deleteAllThreads = () => del('/keel/threads')

// ── Save notifications ────────────────────────────────────────────────────
// Save handlers call notifyKeelDataChanged only after the server confirmed
// the save (2xx). The panel then re-reads the setup state; nothing is
// inferred from page visits or optimistic UI.

export type KeelDataArea = 'profile' | 'family' | 'documents' | 'settings' | 'security' | 'legacy'
const EVENT = 'keel:data-changed'

export function notifyKeelDataChanged(area: KeelDataArea): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { area } }))
}

export function onKeelDataChanged(cb: (area: KeelDataArea) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<{ area: KeelDataArea }>).detail.area)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
