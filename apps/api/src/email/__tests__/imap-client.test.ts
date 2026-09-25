/**
 * fetchRecentEmails — the incremental scan must never drop a message it
 * actually saw. Regression test for a live-reproduced bug: capping an
 * incremental (cursor-present) scan to `limit` while still advancing the
 * saved cursor past every UID the fetch returned silently and permanently
 * skipped whichever messages fell outside the cap — easily triggered by a
 * multi-day reauth gap plus routine transaction alerts outnumbering real
 * policy mail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A minimal fake ImapFlow: `messages` is the full set of {uid, source}
// entries a `fetch()` call yields, independent of any real IMAP range
// syntax — good enough since fetchRecentEmails' own range/query building
// isn't what's under test here.
let messages: { uid: number; source: Buffer }[] = []
const mailboxLock = { release: vi.fn() }

vi.mock('imapflow', () => ({
  // A regular function, not an arrow — `new ImapFlow(...)` needs a real
  // constructor, and only a regular function returning an object can
  // stand in for one.
  ImapFlow: vi.fn().mockImplementation(function FakeImapFlow() {
    return {
      connect: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => mailboxLock),
      mailbox: { exists: messages.length },
      fetch: () => (async function* () { /* overridden per test via mockFetchYields */ })(),
    }
  }),
}))

vi.mock('mailparser', () => ({
  // The message body IS the JSON-encoded fields we want back — avoids
  // needing real MIME to exercise the trimming/cursor logic.
  simpleParser: vi.fn(async (source: Buffer) => {
    const parsed = JSON.parse(source.toString())
    return {
      messageId: parsed.messageId,
      from: { text: parsed.from },
      subject: parsed.subject,
      date: new Date(parsed.date),
      text: parsed.text ?? '',
      attachments: [],
    }
  }),
}))

const { ImapFlow } = await import('imapflow')
const { fetchRecentEmails } = await import('../imap-client.js')

function seedMessages(uids: number[]) {
  messages = uids.map((uid) => ({
    uid,
    source: Buffer.from(JSON.stringify({
      messageId: `m${uid}`,
      from: 'sender@example.com',
      subject: `Message ${uid}`,
      date: new Date(2026, 0, 1).toISOString(),
    })),
  }))
}

function mockFetchYields(rows: { uid: number; source: Buffer }[]) {
  ;(ImapFlow as unknown as ReturnType<typeof vi.fn>).mockImplementation(function FakeImapFlow() {
    return {
      connect: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => mailboxLock),
      mailbox: { exists: rows.length },
      fetch: () => (async function* () {
        for (const row of rows) yield { uid: row.uid, source: row.source }
      })(),
    }
  })
}

const creds = { host: 'imap.example.com', port: 993, useTls: true, username: 'u', password: 'p' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchRecentEmails', () => {
  it('an incremental scan (cursor present) keeps every message the fetch returned, even past `limit`', async () => {
    seedMessages([101, 102, 103, 104, 105])
    mockFetchYields(messages)

    const { emails, highestUid } = await fetchRecentEmails(creds, { sinceUid: 100, limit: 3 })

    expect(emails.map((e) => e.uid)).toEqual([101, 102, 103, 104, 105])
    expect(highestUid).toBe(105)
  })

  it('a first-ever scan (no cursor) still caps to the newest `limit`, and the cursor matches exactly what was kept', async () => {
    seedMessages([1, 2, 3, 4, 5])
    mockFetchYields(messages)

    const { emails, highestUid } = await fetchRecentEmails(creds, { limit: 3 })

    expect(emails.map((e) => e.uid)).toEqual([3, 4, 5])
    // Real bug this guards against: highestUid must never outrun what was
    // actually classified, or the skipped tail is never retried.
    expect(highestUid).toBe(5)
  })

  it('an incremental scan with nothing new returns no messages and an unmoved cursor', async () => {
    mockFetchYields([])
    const { emails, highestUid } = await fetchRecentEmails(creds, { sinceUid: 200 })
    expect(emails).toEqual([])
    expect(highestUid).toBe(200)
  })
})
