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
import { resolvePublicAddress } from '@lifekeel/platform'

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

/** A whole message (headers, body, attachments) larger than this is skipped before it is downloaded and parsed (R25). */
export const MAX_MESSAGE_SOURCE_BYTES = 25 * 1024 * 1024

/** Implicit TLS (993) or STARTTLS (143) only — never a plaintext login (R07). */
export const ALLOWED_IMAP_PORTS = new Set([993, 143])

export function validateImapEndpoint(port: number, useTls: boolean): string | null {
  if (!Number.isInteger(port) || !ALLOWED_IMAP_PORTS.has(port)) {
    return 'IMAP port must be 993 (TLS) or 143 (STARTTLS)'
  }
  if (port === 993 && !useTls) return 'Port 993 requires TLS'
  return null
}

/**
 * Builds a client pinned to a public IP (R07). The hostname is resolved
 * once and every address must be public; the socket then connects to that
 * IP with the original name for TLS verification, so a DNS answer that
 * changes between check and connect can't redirect it to an internal host.
 */
async function buildClient(creds: ImapCredentials): Promise<ImapFlow> {
  const invalid = validateImapEndpoint(creds.port, creds.useTls)
  if (invalid) throw new Error(invalid)
  const address = await resolvePublicAddress(creds.host)
  return new ImapFlow({
    host: address,
    servername: creds.host,
    port: creds.port,
    secure: creds.port === 993,
    doSTARTTLS: creds.port === 143 ? true : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
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
  let client: ImapFlow
  try {
    client = await buildClient(creds)
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Connection refused' }
  }
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
 * Marketing emails embed logos, social icons and spacer pixels as inline
 * (cid:) images — those aren't documents. A real attachment is not inline,
 * and an image under ~20 KB is an icon, not a scanned page.
 */
function isRealAttachment(a: { contentType: string; size: number; related?: boolean; contentDisposition?: string }): boolean {
  if (a.related || a.contentDisposition === 'inline') return false
  if (a.contentType.startsWith('image/') && a.size < 20_000) return false
  return true
}

export async function parseMessage(uid: number, source: Buffer): Promise<FetchedEmail> {
  const parsed = await simpleParser(source)
  return {
    uid,
    messageId: parsed.messageId ?? `imap-uid-${uid}`,
    from: parsed.from?.text ?? 'Unknown sender',
    subject: parsed.subject ?? '(no subject)',
    date: parsed.date ?? new Date(),
    textSnippet: (parsed.text ?? '').slice(0, 4000),
    attachments: (parsed.attachments ?? [])
      .filter((a) => ATTACHMENT_MIME_ALLOWLIST.has(a.contentType) && a.size <= MAX_ATTACHMENT_BYTES && isRealAttachment(a))
      .map((a) => ({ filename: a.filename ?? 'attachment', contentType: a.contentType, content: a.content })),
  }
}

/** Words that mark an email as possibly about a policy or protection product. */
export const POLICY_SEARCH_KEYWORDS = [
  'insurance', 'policy', 'premium', 'renewal', 'cover', 'claim', 'pension', 'mortgage', 'assistance',
]

/**
 * Looks back over the last `sinceDays` for mail whose subject mentions a
 * policy-ish word — the server does the filtering, so a 90-day look-back
 * doesn't mean downloading and classifying every message. Independent of
 * the incremental UID cursor.
 */
export async function searchPolicyEmails(
  creds: ImapCredentials,
  opts: { sinceDays: number; limit?: number },
): Promise<FetchedEmail[]> {
  const limit = opts.limit ?? 60
  const client = await buildClient(creds)
  const emails: FetchedEmail[] = []
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000)
      const uids = (await client.search(
        { since, or: POLICY_SEARCH_KEYWORDS.map((k) => ({ subject: k })) },
        { uid: true },
      )) || []
      const newest = uids.sort((a, b) => a - b).slice(-limit)
      if (newest.length === 0) return []
      const small: number[] = []
      for await (const msg of client.fetch(newest, { uid: true, size: true }, { uid: true })) {
        if ((msg.size ?? 0) <= MAX_MESSAGE_SOURCE_BYTES) small.push(msg.uid)
      }
      if (small.length === 0) return []
      for await (const msg of client.fetch(small, { uid: true, source: true }, { uid: true })) {
        if (msg.source) emails.push(await parseMessage(msg.uid, msg.source))
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  return emails.sort((a, b) => a.uid - b.uid)
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
  const client = await buildClient(creds)
  const emails: FetchedEmail[] = []
  let highestUid = opts.sinceUid ?? 0
  // A cursor means "since last sync", already bounded to whatever's
  // actually new — not the first-ever "just the most recent N" scan.
  const incremental = opts.sinceUid !== undefined

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const range = incremental ? `${opts.sinceUid! + 1}:*` : undefined
      const exists = client.mailbox ? client.mailbox.exists : limit
      const fetchQuery = range ? { uid: range } : { seq: `${Math.max(1, exists - limit + 1)}:*` }

      // Sizes first, bodies second (R25): an oversized message advances the
      // cursor but is never downloaded or parsed.
      const small: number[] = []
      for await (const msg of client.fetch(fetchQuery, { uid: true, size: true })) {
        if (msg.uid > highestUid) highestUid = msg.uid
        if ((msg.size ?? 0) <= MAX_MESSAGE_SOURCE_BYTES) small.push(msg.uid)
      }
      if (small.length > 0) {
        for await (const msg of client.fetch(small, { uid: true, source: true }, { uid: true })) {
          if (msg.source) emails.push(await parseMessage(msg.uid, msg.source))
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  const sorted = emails.sort((a, b) => a.uid - b.uid)
  // First-ever scan only: keep the newest `limit`. Bug this replaced —
  // found live on a real reconnected mailbox: an incremental scan was
  // ALSO capped to the newest `limit`, while `highestUid` (the saved
  // cursor) still advanced past every message the UID range actually
  // returned, not just the kept ones. Any scan where more than `limit`
  // messages arrived since the last sync — trivial after even a few days
  // of a dead refresh token, with routine transaction alerts mixed in —
  // silently and permanently skipped the older messages in that batch:
  // the cursor moved past them, so no later scan would ever see them
  // again. A real insurance-claim thread in your account was lost this
  // way. Never cap an incremental scan; it's already bounded to "what's
  // new", not the whole mailbox.
  return { emails: incremental ? sorted : sorted.slice(-limit), highestUid }
}
