/**
 * R38/R25: Gmail mailbox reads through the REST API — read-only scope, a
 * size check before any body is downloaded, and a cursor that never skips.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('mailparser', () => ({
  simpleParser: vi.fn(async (source: Buffer) => {
    const parsed = JSON.parse(source.toString())
    return { messageId: parsed.id, from: { text: 'a@b.c' }, subject: parsed.id, date: new Date(), text: '', attachments: [] }
  }),
}))

const { fetchRecentGmail } = await import('../gmail-api.js')

interface FakeMessage {
  id: string
  internalDate: number
  size: number
}

function stubGmail(messages: FakeMessage[]) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const u = new URL(url)
      if (u.pathname.endsWith('/messages')) {
        return new Response(JSON.stringify({ messages: [...messages].reverse().map((m) => ({ id: m.id })) }))
      }
      const id = u.pathname.split('/').at(-1)!
      const m = messages.find((x) => x.id === id)!
      if (u.searchParams.get('format') === 'minimal') {
        return new Response(JSON.stringify({ sizeEstimate: m.size, internalDate: String(m.internalDate) }))
      }
      const raw = Buffer.from(JSON.stringify({ id })).toString('base64url')
      return new Response(JSON.stringify({ raw, internalDate: String(m.internalDate) }))
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchRecentGmail', () => {
  it('skips an oversized message without downloading its body', async () => {
    const calls = stubGmail([
      { id: 'small', internalDate: 1_700_000_000_000, size: 10_000 },
      { id: 'huge', internalDate: 1_700_000_100_000, size: 40 * 1024 * 1024 },
    ])
    const { emails } = await fetchRecentGmail('token', { limit: 25 })
    expect(emails.map((e) => e.messageId)).toEqual(['small'])
    expect(calls.some((c) => c.includes('/huge?format=raw'))).toBe(false)
  })

  it('returns messages oldest first with a seconds cursor that only moves forward', async () => {
    stubGmail([
      { id: 'a', internalDate: 1_700_000_000_000, size: 1 },
      { id: 'b', internalDate: 1_700_000_050_000, size: 1 },
    ])
    const { emails, highestUid } = await fetchRecentGmail('token', { sinceUid: 1_699_999_000 })
    expect(emails.map((e) => e.messageId)).toEqual(['a', 'b'])
    expect(highestUid).toBe(1_700_000_050)
  })
})
