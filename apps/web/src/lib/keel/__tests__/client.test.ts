import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSseBlock, streamTurn } from '../client'
import { choosePresentation } from '../presentation'
import { resolveRouteKey } from '../routes'
import { collectAnchors, requestSpotlight } from '../spotlight'
import type { KeelEvent } from '../types'

const req = (signal = new AbortController().signal) => ({
  message: 'Where do I start?',
  threadId: null,
  pageContext: { route: '/family', anchors: ['a'] },
  signal,
})

function sseResponse(chunks: string[], status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}
const block = (e: KeelEvent) => `event: keel\ndata: ${JSON.stringify(e)}\n\n`

afterEach(() => vi.unstubAllGlobals())

describe('streamTurn', () => {
  it('reassembles events split across chunk boundaries, in order', async () => {
    const text = block({ type: 'text', content: 'héllo — ünïcode' })
    const done = block({ type: 'done', route: 'setup', is_live: false, thread_id: 't1' })
    const cut = Math.floor(text.length / 2)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([text.slice(0, cut), text.slice(cut) + done])),
    )
    const seen: KeelEvent[] = []
    await streamTurn(req(), (e) => seen.push(e))
    expect(seen).toEqual([
      { type: 'text', content: 'héllo — ünïcode' },
      { type: 'done', route: 'setup', is_live: false, thread_id: 't1' },
    ])
  })

  it("sends only the route, step and anchors as page context, with the caller's credentials", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([block({ type: 'done', route: 'setup', is_live: false })]),
    )
    vi.stubGlobal('fetch', fetchMock)
    await streamTurn(req(), () => {})
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/keel\/turns$/)
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Accept']).toBe('text/event-stream')
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'Where do I start?',
      page_context: { route: '/family', anchors: ['a'] },
    })
  })

  it.each([
    [401, 'signed_out'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ])('HTTP %i becomes an honest %s error and still ends with done', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status })),
    )
    const seen: KeelEvent[] = []
    await streamTurn(req(), (e) => seen.push(e))
    expect(seen[0]).toEqual({ type: 'error', code })
    expect(seen.at(-1)).toMatchObject({ type: 'done', route: 'fallback' })
  })

  it('a network failure is an unavailable error, not silence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    )
    const seen: KeelEvent[] = []
    await streamTurn(req(), (e) => seen.push(e))
    expect(seen.map((e) => e.type)).toEqual(['error', 'done'])
  })

  it('an intentional abort (sign-out, Stop, new chat) emits nothing', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort()
        throw new DOMException('aborted', 'AbortError')
      }),
    )
    const seen: KeelEvent[] = []
    await streamTurn(req(controller.signal), (e) => seen.push(e))
    expect(seen).toEqual([])
  })

  it('falls back to a JSON body when the server does not stream', async () => {
    const events: KeelEvent[] = [
      { type: 'text', content: 'hi' },
      { type: 'done', route: 'help', is_live: false },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ events })),
    )
    const seen: KeelEvent[] = []
    await streamTurn(req(), (e) => seen.push(e))
    expect(seen).toEqual(events)
  })
})

describe('parseSseBlock', () => {
  it('ignores comments, heartbeats and malformed data', () => {
    expect(parseSseBlock(': keepalive')).toBeNull()
    expect(parseSseBlock('event: keel\ndata: {not json')).toBeNull()
    expect(parseSseBlock('event: keel\ndata: {"type":"text","content":"x"}')).toEqual({
      type: 'text',
      content: 'x',
    })
  })
})

describe('route keys', () => {
  it('resolves known keys and rejects everything else, including prototype names and URLs', () => {
    expect(resolveRouteKey('upload')).toBe('/upload')
    for (const bad of [
      '',
      'nope',
      'https://evil.test',
      '//evil.test',
      'javascript:alert(1)',
      '__proto__',
      'constructor',
      'toString',
    ])
      expect(resolveRouteKey(bad)).toBeNull()
  })
})

describe('presentation', () => {
  it.each([
    [390, 400, false, 'sheet'],
    [820, 400, false, 'sheet'],
    [1280, 400, true, 'docked'],
    [1440, 400, true, 'docked'],
    [1920, 560, true, 'docked'],
    [1100, 400, true, 'overlay'],
    [1024, 400, false, 'overlay'],
    [1100, 400, false, 'docked'],
  ] as const)('viewport %i, panel %i, rail %s -> %s', (vw, panel, rail, expected) => {
    expect(choosePresentation(vw, panel, rail)).toBe(expected)
  })
})

describe('spotlight', () => {
  it('collects only valid anchor ids, never values', () => {
    document.body.innerHTML = `<input data-keel-anchor="salary" value="123456"><i data-keel-anchor="Bad Anchor!"></i><b data-keel-anchor="policies"></b>`
    expect(collectAnchors()).toEqual(['salary', 'policies'])
  })

  it('marks the element, then clears the mark', () => {
    vi.useFakeTimers()
    document.body.innerHTML = `<div data-keel-anchor="policies"></div>`
    const el = document.querySelector<HTMLElement>('[data-keel-anchor]')!
    el.scrollIntoView = vi.fn()
    requestSpotlight('policies')
    expect(el.getAttribute('data-keel-spotlight')).toBe('on')
    vi.advanceTimersByTime(4000)
    expect(el.hasAttribute('data-keel-spotlight')).toBe(false)
    vi.useRealTimers()
  })

  it('ignores an anchor that is not a safe id', () => {
    expect(() => requestSpotlight('"] , body[x="')).not.toThrow()
  })
})
