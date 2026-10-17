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

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

export function registerAuditLogRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { action?: string; limit?: string; before?: string } }>(
    '/audit-log',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const col = getTenantCollection<AuditEntry & Record<string, unknown>>(db, 'audit_log', tenant_id)

      const filter: Record<string, unknown> = {}
      if (req.query.action) filter['action'] = req.query.action
      if (req.query.before) {
        const before = new Date(req.query.before)
        if (Number.isNaN(before.getTime())) {
          return reply.status(400).send({ error: 'Invalid "before" timestamp' })
        }
        filter['timestamp'] = { $lt: before }
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)

      const entries = await col
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray()

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
}
