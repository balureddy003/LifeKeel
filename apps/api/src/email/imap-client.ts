/**
 * Generic IMAP client — the whole point of this connector: it works
 * identically against any provider's IMAP server (Gmail, Outlook, Yahoo,
 * iCloud, a custom domain's mail server), given a host/port/username/
 * password. No per-provider API integration, no OAuth app registration
 * per provider.
 *
 * Gmail specifically also supports XOAUTH2 (an access token in place of a
 * password) over this same IMAP connection — see accessToken below and
 * email/gmail-oauth.ts. That's a second way to authenticate the identical
 * IMAP session, not a second connector: everything downstream (fetching,
 * classifying, scanning) is unchanged either way.
 */

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

export interface ImapCredentials {
  host: string
  port: number
  useTls: boolean
  username: string
  /** Exactly one of password/accessToken is expected — accessToken wins if both are present. */
  password?: string
  accessToken?: string
}

export interface FetchedEmailAttachment {
  filename: string
  contentType: string
  content: Buffer
}

export interface FetchedEmail {
  uid: number
  messageId: string
  from: string
  subject: string
  date: Date
  textSnippet: string
  attachments: FetchedEmailAttachment[]
}

const ATTACHMENT_MIME_ALLOWLIST = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

function buildClient(creds: ImapCredentials): ImapFlow {
  return new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.useTls,
    auth: creds.accessToken
      ? { user: creds.username, accessToken: creds.accessToken }
      : { user: creds.username, pass: creds.password ?? '' },
    logger: false,
  })
}

/** Verifies credentials actually work by connecting and logging out — same
 * "validate before saving" pattern connector-credentials.ts uses for API-key
 * connectors, so a typo'd password fails immediately instead of silently
 * saving a broken connection. */
export async function testImapConnection(
  creds: ImapCredentials,
): Promise<{ success: boolean; message?: string }> {
  const client = buildClient(creds)
  try {
    await client.connect()
    await client.logout()
    return { success: true }
  } catch (err) {
    // imapflow throws a generic `new Error('Command failed')` for every NO/BAD
    // IMAP response — auth failure, disabled IMAP access, anything — and puts
    // the actual server-provided reason (e.g. Gmail's "[AUTHENTICATIONFAILED]
    // Invalid credentials (Failure)") on `err.responseText` instead of the
    // message. Using `err.message` alone means every failure reads as the
    // same uninformative "Command failed", regardless of the real cause.
    const responseText = err && typeof err === 'object' && 'responseText' in err
      ? String((err as { responseText?: unknown }).responseText)
      : undefined
    const message = responseText || (err instanceof Error ? err.message : 'Connection failed')
    return { success: false, message }
  } finally {
    client.close()
  }
}

/**
 * Fetches messages from INBOX newer than `sinceUid` (exclusive) — or, with
 * no cursor yet, the most recent `limit` messages — for incremental scans
 * that don't reprocess the same mail every run.
 */
export async function fetchRecentEmails(
  creds: ImapCredentials,
  opts: { sinceUid?: number; limit?: number } = {},
): Promise<{ emails: FetchedEmail[]; highestUid: number }> {
  const limit = opts.limit ?? 25
  const client = buildClient(creds)
  const emails: FetchedEmail[] = []
  let highestUid = opts.sinceUid ?? 0

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const range = opts.sinceUid ? `${opts.sinceUid + 1}:*` : undefined
      const exists = client.mailbox ? client.mailbox.exists : limit
      const fetchQuery = range ? { uid: range } : { seq: `${Math.max(1, exists - limit + 1)}:*` }

      for await (const msg of client.fetch(fetchQuery, { uid: true, source: true })) {
        if (msg.uid > highestUid) highestUid = msg.uid
        if (!msg.source) continue

        const parsed = await simpleParser(msg.source)
        emails.push({
          uid: msg.uid,
          messageId: parsed.messageId ?? `imap-uid-${msg.uid}`,
          from: parsed.from?.text ?? 'Unknown sender',
          subject: parsed.subject ?? '(no subject)',
          date: parsed.date ?? new Date(),
          textSnippet: (parsed.text ?? '').slice(0, 4000),
          attachments: (parsed.attachments ?? [])
            .filter((a) => ATTACHMENT_MIME_ALLOWLIST.has(a.contentType) && a.size <= MAX_ATTACHMENT_BYTES)
            .map((a) => ({
              filename: a.filename ?? 'attachment',
              contentType: a.contentType,
              content: a.content,
            })),
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  // A UID-range fetch can return more than `limit` if many arrived since the
  // last scan — keep the newest `limit`, oldest first for stable ordering.
  const trimmed = emails.sort((a, b) => a.uid - b.uid).slice(-limit)
  return { emails: trimmed, highestUid }
}
