/**
 * How alerts can reach a family right now (PRD-140): which channels have a
 * working device, what failed recently, and that email is the floor. Counts
 * and times only; no device identifiers leave this module.
 */
import type { Db } from 'mongodb'
import { resolveAlertEmail } from './alert-email.js'

export interface ChannelState {
  email: { available: boolean }
  web_push: { devices: number; enabled: boolean }
  mobile_push: { devices: number; enabled: boolean; platforms: string[] }
  recent_failures: { web_push: number; mobile_push: number; last_at: string | null }
  /** Where the next alert goes first: the best channel that has a device. */
  first_channel: 'mobile_push' | 'web_push' | 'email' | 'none'
}

const FAILURE_WINDOW_DAYS = 30

export async function getChannelState(
  db: Db,
  tenantId: string,
  now: Date = new Date(),
): Promise<ChannelState> {
  const prefs = (await db.collection('delivery_preferences').findOne({ tenant_id: tenantId })) as {
    email_to?: string
    web_push_enabled?: boolean
    mobile_push_enabled?: boolean
  } | null
  const [web, tokens, failures] = await Promise.all([
    db.collection('web_push_subscriptions').countDocuments({ tenant_id: tenantId }),
    db
      .collection('mobile_push_tokens')
      .find({ tenant_id: tenantId })
      .project({ platform: 1 })
      .toArray() as unknown as Promise<{ platform?: string }[]>,
    db
      .collection('push_failures')
      .find({
        tenant_id: tenantId,
        at: { $gte: new Date(now.getTime() - FAILURE_WINDOW_DAYS * 86_400_000) },
      })
      .toArray() as unknown as Promise<{ channel: string; at: Date }[]>,
  ])
  // email_to is only set when an organizer picked an address explicitly —
  // nothing in signup ever writes one. Without the roster/account fallback
  // every family read as "no email on file" even though the account (and
  // the delivery floor) has one.
  const email = Boolean(prefs?.email_to ?? (await resolveAlertEmail(db, tenantId)))
  const last = failures.reduce<Date | null>((m, f) => (m === null || f.at > m ? f.at : m), null)
  return {
    email: { available: email },
    web_push: { devices: web, enabled: prefs?.web_push_enabled === true && web > 0 },
    mobile_push: {
      devices: tokens.length,
      enabled: prefs?.mobile_push_enabled === true && tokens.length > 0,
      platforms: [...new Set(tokens.map((t) => t.platform).filter((p): p is string => !!p))],
    },
    recent_failures: {
      web_push: failures.filter((f) => f.channel === 'web_push').length,
      mobile_push: failures.filter((f) => f.channel === 'mobile_push').length,
      last_at: last?.toISOString() ?? null,
    },
    first_channel:
      tokens.length > 0 ? 'mobile_push' : web > 0 ? 'web_push' : email ? 'email' : 'none',
  }
}
