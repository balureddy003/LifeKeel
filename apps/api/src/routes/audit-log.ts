/**
 * GET /audit-log — read-only view over the tenant's own audit_log
 * collection (audit/audit-log.ts writes every security-relevant action
 * with a 7-year TTL, but nothing ever read it back — remediation item 22).
 *
 * Tenant-scoped by authContext like every other route, append-only from
 * the client's perspective — there is deliberately no write, update, or
 * delete here. The user can only ever see their own family's trail.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { AuditEntry } from '../audit/audit-log.js'
import type { OperatorAuditEntry } from '../operator/operator-audit.js'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function registerAuditLogRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { action?: string; limit?: string; before?: string } }>(
    '/audit-log',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const col = getTenantCollection<AuditEntry & Record<string, unknown>>(
        db,
        'audit_log',
        tenant_id,
      )

      const filter: Record<string, unknown> = {}
      if (req.query.action) filter['action'] = req.query.action
      if (req.query.before) {
        const before = new Date(req.query.before)
        if (Number.isNaN(before.getTime())) {
          return reply.status(400).send({ error: 'Invalid "before" timestamp' })
        }
        filter['timestamp'] = { $lt: before }
      }

      const limit = Math.min(
        Math.max(parseInt(req.query.limit ?? '', 10) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      )

      const entries = await col.find(filter).sort({ timestamp: -1 }).limit(limit).toArray()

      return {
        entries: entries.map((e: AuditEntry) => ({
          action: e.action,
          resource_type: e.resource_type,
          resource_id: e.resource_id,
          user_id: e.user_id,
          timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
          metadata: e.metadata ?? {},
        })),
      }
    },
  )

  /** GET /audit-log/operator-access — when LifeKeel staff opened or changed
   *  this household's account (ISO 27001 A.8.15, gap G-OFI-04). Reads the
   *  platform-wide operator_audit_log, so the filter is built here from the
   *  household's own user ids, tenant ids and connector ids. Returns what
   *  happened and when, never which operator or their free-text reason. */
  app.get<{ Querystring: { limit?: string; before?: string } }>(
    '/audit-log/operator-access',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const createdAt: Record<string, Date> = {}
      if (req.query.before) {
        const before = new Date(req.query.before)
        if (Number.isNaN(before.getTime())) {
          return reply.status(400).send({ error: 'Invalid "before" timestamp' })
        }
        createdAt['$lt'] = before
      }
      const limit = Math.min(
        Math.max(parseInt(req.query.limit ?? '', 10) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      )

      const [members, tenant] = await Promise.all([
        db
          .collection('users')
          .find({ tenant_id }, { projection: { _id: 0, id: 1 } })
          .toArray(),
        db.collection('tenants').findOne({ tenant_id }, { projection: { _id: 0, id: 1 } }),
      ])
      const tenantIds = [tenant_id, ...(typeof tenant?.['id'] === 'string' ? [tenant['id']] : [])]
      const userIds = members
        .map((m) => m['id'])
        .filter((id): id is string => typeof id === 'string')

      const entries = await db
        .collection<OperatorAuditEntry>('operator_audit_log')
        .find({
          $or: [
            { target_type: 'tenant', target_id: { $in: tenantIds } },
            { target_type: 'user', target_id: { $in: userIds } },
            { target_type: 'connector', target_id: { $regex: `^${escapeRegex(tenant_id)}/` } },
          ],
          ...(createdAt['$lt'] ? { created_at: createdAt } : {}),
        })
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray()

      return {
        entries: entries.map((e) => ({
          action: e.action,
          target_type: e.target_type,
          about_you: e.target_type === 'user' && e.target_id === req.authContext.user_id,
          timestamp: e.created_at.toISOString(),
        })),
      }
    },
  )
}
