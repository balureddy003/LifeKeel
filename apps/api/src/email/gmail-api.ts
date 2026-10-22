/**
 * Gmail mailbox reads over the Gmail REST API (R38).
 *
 * The family Gmail connector used IMAP with XOAUTH2, which Google only
 * allows under https://mail.google.com/ — full read, send and permanent
 * delete of the mailbox. The REST API reads the same messages under
 * gmail.readonly, so a leaked refresh token can no longer send or delete
 * mail. Grants issued before this change carry the broader scope, which
 * also covers these reads, so they keep working until the family reconnects.
 *
 * `uid` here is the message's internalDate in epoch seconds: the scan
 * cursor only needs "newer than", and seconds stay inside a JS integer.
 */
import {
  MAX_MESSAGE_SOURCE_BYTES,
  POLICY_SEARCH_KEYWORDS,
  parseMessage,
  type FetchedEmail,
} from './imap-client.js'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const REQUEST_TIMEOUT_MS = 20_000
/** Hard ceiling per incremental scan; the oldest ones are taken first so the cursor never skips mail. */
const MAX_INCREMENTAL_MESSAGES = 200

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Gmail API ${res.status} on ${path.split('?')[0]}`)
  return (await res.json()) as T
}

interface ListResponse {
  messages?: Array<{ id: string }>
  nextPageToken?: string
}

async function listIds(accessToken: string, q: string, max: number): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q, maxResults: String(Math.min(500, max)) })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await gmailGet<ListResponse>(accessToken, `/messages?${params}`)
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < max)
  return ids
}

async function fetchOne(accessToken: string, id: string): Promise<FetchedEmail | null> {
  // Size check before downloading the body (R25): one oversized MIME
  // message must not be pulled into memory and parsed.
  const meta = await gmailGet<{ sizeEstimate?: number; internalDate?: string }>(
    accessToken,
    `/messages/${encodeURIComponent(id)}?format=minimal`,
  )
  if ((meta.sizeEstimate ?? 0) > MAX_MESSAGE_SOURCE_BYTES) return null
  const full = await gmailGet<{ raw?: string; internalDate?: string }>(
    accessToken,
    `/messages/${encodeURIComponent(id)}?format=raw`,
  )
  if (!full.raw) return null
  const uid = Math.floor(Number(full.internalDate ?? meta.internalDate ?? Date.now()) / 1000)
  return parseMessage(uid, Buffer.from(full.raw, 'base64url'))
}

async function fetchMany(accessToken: string, ids: string[]): Promise<FetchedEmail[]> {
  const out: FetchedEmail[] = []
  for (const id of ids) {
    const email = await fetchOne(accessToken, id)
    if (email) out.push(email)
  }
  return out.sort((a, b) => a.uid - b.uid)
}

/** Same contract as imap-client's fetchRecentEmails, with `sinceUid` in epoch seconds. */
export async function fetchRecentGmail(
  accessToken: string,
  opts: { sinceUid?: number; limit?: number } = {},
): Promise<{ emails: FetchedEmail[]; highestUid: number }> {
  const limit = opts.limit ?? 25
  if (opts.sinceUid === undefined) {
    const ids = await listIds(accessToken, 'in:inbox', limit)
    const emails = await fetchMany(accessToken, ids.slice(0, limit))
    return { emails, highestUid: emails.at(-1)?.uid ?? Math.floor(Date.now() / 1000) }
  }
  // `after:` is second-granular; re-reading the boundary second is safe
  // because the scan dedupes by Message-ID.
  const ids = await listIds(accessToken, `in:inbox after:${opts.sinceUid}`, 5000)
  // The list is newest first, so the tail is the oldest unread-by-us mail.
  const batch = ids.slice(-MAX_INCREMENTAL_MESSAGES)
  const emails = await fetchMany(accessToken, batch)
  const highestUid = emails.reduce((max, e) => Math.max(max, e.uid), opts.sinceUid)
  return { emails, highestUid }
}

export async function searchPolicyGmail(
  accessToken: string,
  opts: { sinceDays: number; limit?: number },
): Promise<FetchedEmail[]> {
  const subjects = POLICY_SEARCH_KEYWORDS.join(' OR ')
  const q = `in:inbox newer_than:${Math.max(1, Math.floor(opts.sinceDays))}d subject:(${subjects})`
  const ids = await listIds(accessToken, q, opts.limit ?? 60)
  return fetchMany(accessToken, ids.slice(0, opts.limit ?? 60))
}
