/**
 * One-click opt-out for the family heartbeat email (PRD-136; RFC 8058).
 *
 * The heartbeat carries `List-Unsubscribe: <url>` and
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Mail clients (and
 * Gmail/Yahoo bulk-sender rules) POST to that URL with no login, so the
 * proof is an HMAC over (tenant, member) — possession of the email.
 *
 *   POST /heartbeat/unsubscribe — performs the opt-out (what mail clients call).
 *   GET  /heartbeat/unsubscribe — a confirm page whose button POSTs. A GET
 *        never changes state, so link scanners that prefetch URLs can't
 *        silently unsubscribe a family.
 *
 * Preference semantics are unchanged: heartbeat_cadence is tenant-level
 * today (see DeliveryPreferences), so this sets the tenant's cadence to
 * 'off', exactly what PATCH /family/notifications does. Any active adult
 * can therefore switch the family's heartbeat off; the organizer re-enables
 * it in settings. Only the heartbeat is affected — critical alerts and
 * account mail are untouched. Tier 0 bookkeeping.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

export function heartbeatUnsubToken(tenantId: string, memberId: string): string {
  return createHmac('sha256', process.env['JWT_SECRET'] ?? 'dev-secret')
    .update(`unsub-heartbeat:${tenantId}:${memberId}`)
    .digest('base64url')
}

export function verifyHeartbeatUnsubToken(
  tenantId: string,
  memberId: string,
  token: string,
): boolean {
  const expected = Buffer.from(heartbeatUnsubToken(tenantId, memberId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function heartbeatUnsubUrl(apiBase: string, tenantId: string, memberId: string): string {
  const base = apiBase.replace(/\/$/, '')
  const q = new URLSearchParams({
    tenant: tenantId,
    member: memberId,
    sig: heartbeatUnsubToken(tenantId, memberId),
  })
  return `${base}/heartbeat/unsubscribe?${q.toString()}`
}

const page = (msg: string, extra = '') =>
  `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:80vh;"><div style="max-width:420px;text-align:center;color:#444;"><p>${msg}</p>${extra}</div></body></html>`

const INVALID = 'This unsubscribe link is invalid or has expired.'

export async function registerHeartbeatUnsubscribeRoutes(
  app: FastifyInstance,
  db: Db,
): Promise<void> {
  // Mail clients send the RFC 8058 body `List-Unsubscribe=One-Click` as
  // form-urlencoded. Fastify has no parser for that by default, so accept
  // it as an opaque string in this plugin's scope only; the signed query
  // string carries everything we need.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    )

    type Q = { Querystring: { tenant?: string; member?: string; sig?: string } }
    const valid = (q: Q['Querystring']) =>
      !!q.tenant && !!q.member && !!q.sig && verifyHeartbeatUnsubToken(q.tenant, q.member, q.sig)

    scope.get<Q>(
      '/heartbeat/unsubscribe',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (!valid(req.query)) return reply.status(400).type('text/html').send(page(INVALID))
        const { tenant, member, sig } = req.query
        const action = `?${new URLSearchParams({ tenant: tenant!, member: member!, sig: sig! }).toString()}`
        return reply
          .type('text/html')
          .send(
            page(
              'Stop the weekly/monthly family heartbeat email?',
              `<form method="post" action="${action.replace(/&/g, '&amp;')}"><button type="submit" style="padding:10px 18px;border-radius:10px;border:0;background:#7c6ef0;color:#fff;font-weight:600;">Unsubscribe</button></form>`,
            ),
          )
      },
    )

    scope.post<Q>(
      '/heartbeat/unsubscribe',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (!valid(req.query)) return reply.status(400).type('text/html').send(page(INVALID))
        const tenant_id = req.query.tenant!
        const memberId = req.query.member!
        // A removed/pending member's old link must not switch off the family's email.
        const family = (await db.collection('family_groups').findOne({ tenant_id })) as {
          members?: { id: string; status: string }[]
        } | null
        if (!family?.members?.some((m) => m.id === memberId && m.status === 'active')) {
          return reply.status(400).type('text/html').send(page(INVALID))
        }
        await db
          .collection('delivery_preferences')
          .updateOne(
            { tenant_id },
            { $set: { heartbeat_cadence: 'off' }, $setOnInsert: { tenant_id, enabled: true } },
            { upsert: true },
          )
        return reply
          .type('text/html')
          .send(
            page(
              "You're unsubscribed from the family heartbeat email. Important alerts and account emails still arrive; the organizer can turn the heartbeat back on in Settings → Notifications.",
            ),
          )
      },
    )
  })
}
