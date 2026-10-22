import { getApiBase } from './env'
import { credFetch } from './http'
import { invalidateCache } from './fetch-cache'
import { getSessionToken } from '@/lib/session-token'

export interface LookBackResult {
  scanned: number
  inboxItemsCreated: number
  documentsCreated: number
}

/**
 * One-off search of the connected mailbox for policy/insurance mail from the
 * last `days` days (POST /connectors/email/scan { days }). Independent of the
 * automatic incremental scan. Null when the request fails.
 */
export async function searchMailboxForPolicies(days = 90): Promise<LookBackResult | null> {
  const token = typeof window === 'undefined' ? null : getSessionToken()
  const res = await credFetch(`${getApiBase()}/connectors/email/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ days }),
  }).catch(() => null)
  if (!res || !res.ok) return null
  invalidateCache('inbox-items')
  return (await res.json()) as LookBackResult
}
