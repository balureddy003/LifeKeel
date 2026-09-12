/**
 * Audit Trail — Full audit trail for moments and workflow runs.
 *
 * Phase 2 Feature: Trust & Transparency
 *
 * Routes:
 *   GET  /moments/:id/audit-trail  — Get full audit trail for a moment
 *   GET  /workflows/runs/:id/audit-trail  — Get audit trail for a workflow run
 *   GET  /moments/:id/export  — Export audit trail (PDF, CSV, JSON)
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'audit-trail', version: '0.0.0' })

// ── Schema ─────────────────────────────────────────────────────────────────────

const AuditEventTypeSchema = z.enum([
  'signal',
  'ai_analysis',
  'suggestion',
  'approval',
  'action',
  'verification',
  'system',
])

const AuditEventSchema = z.object({
  id: z.string(),
  moment_id: z.string().optional(),
  workflow_run_id: z.string().optional(),
  timestamp: z.string(),
  type: AuditEventTypeSchema,
  content: z.string(),
  details: z.record(z.any()).optional(),
  sources: z.array(z.object({
    type: z.string(),
    id: z.string(),
    name: z.string(),
    url: z.string().optional(),
    confidence: z.number().optional(),
  })).optional(),
  user_id: z.string().optional(),
  tenant_id: z.string(),
})

export type AuditEvent = z.infer<typeof AuditEventSchema>

const ExportFormatSchema = z.enum(['pdf', 'csv', 'json'])

// ── Route Handlers ─────────────────────────────────────────────────────────────

export async function registerAuditTrailRoutes(app: FastifyInstance, db: Db) {
  // Create collection and indexes
  const col = db.collection<AuditEvent>('audit_events')
  col.createIndex({ moment_id: 1, timestamp: -1 }).catch(() => {})
  col.createIndex({ workflow_run_id: 1, timestamp: -1 }).catch(() => {})
  col.createIndex({ tenant_id: 1, timestamp: -1 }).catch(() => {})
  col.createIndex({ type: 1, timestamp: -1 }).catch(() => {})

  // ── GET /moments/:id/audit-trail ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/moments/:id/audit-trail', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id: momentId } = req.params

    const { limit = 100, offset = 0, type } = req.query as {
      limit?: number
      offset?: number
      type?: string
    }

    const filter: any = { moment_id: momentId, tenant_id }
    if (type) {
      filter.type = type
    }

    try {
      const events = await col
        .find(filter)
        .sort({ timestamp: 1 })
        .skip(offset)
        .limit(limit)
        .toArray()

      const total = await col.countDocuments(filter)

      return reply.status(200).send({
        events,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
      })
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch audit trail')
      return reply.status(500).send({
        error: 'Failed to fetch audit trail',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── GET /workflows/runs/:id/audit-trail ───────────────────────────────────────
  app.get<{ Params: { id: string } }>('/workflows/runs/:id/audit-trail', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id: workflowRunId } = req.params

    const { limit = 100, offset = 0, type } = req.query as {
      limit?: number
      offset?: number
      type?: string
    }

    const filter: any = { workflow_run_id: workflowRunId, tenant_id }
    if (type) {
      filter.type = type
    }

    try {
      const events = await col
        .find(filter)
        .sort({ timestamp: 1 })
        .skip(offset)
        .limit(limit)
        .toArray()

      const total = await col.countDocuments(filter)

      return reply.status(200).send({
        events,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
      })
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch workflow audit trail')
      return reply.status(500).send({
        error: 'Failed to fetch workflow audit trail',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── GET /moments/:id/export ─────────────────────────────────────────────────
  app.get<{ Params: { id: string }, Querystring: { format: string } }>(
    '/moments/:id/export',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { id: momentId } = req.params
      const { format = 'json' } = req.query

      const parsed = ExportFormatSchema.safeParse(format)
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid export format',
          valid_formats: ['pdf', 'csv', 'json'],
        })
      }

      try {
        const events = await col
          .find({ moment_id: momentId, tenant_id })
          .sort({ timestamp: 1 })
          .toArray()

        if (parsed.data === 'json') {
          reply.header('Content-Type', 'application/json')
          reply.header('Content-Disposition', `attachment; filename="audit-trail-${momentId}.json"`)
          return reply.send(JSON.stringify(events, null, 2))
        } else if (parsed.data === 'csv') {
          // Convert to CSV
          const headers = ['id', 'timestamp', 'type', 'content', 'sources']
          const rows = events.map(e => [
            e.id,
            e.timestamp,
            e.type,
            `"${e.content.replace(/"/g, '""')}"`,
            JSON.stringify(e.sources || []),
          ])
          const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
          
          reply.header('Content-Type', 'text/csv')
          reply.header('Content-Disposition', `attachment; filename="audit-trail-${momentId}.csv"`)
          return reply.send(csv)
        } else if (parsed.data === 'pdf') {
          // For PDF, we'll return a placeholder for now
          // In production, this would use a PDF generation library
          reply.header('Content-Type', 'application/json')
          return reply.status(501).send({
            error: 'PDF export not yet implemented',
            message: 'Please use JSON or CSV format for now',
          })
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to export audit trail')
        return reply.status(500).send({
          error: 'Failed to export audit trail',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  )

  // ── POST /audit-events ───────────────────────────────────────────────────────
  // Internal endpoint to create audit events (called by workflow engine, etc.)
  app.post('/audit-events', async (req, reply) => {
    const { tenant_id } = req.authContext

    const parsed = AuditEventSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid audit event',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const event: AuditEvent = {
      ...parsed.data,
      tenant_id,
      timestamp: parsed.data.timestamp || new Date().toISOString(),
    }

    try {
      await col.insertOne(event)
      return reply.status(201).send({ event })
    } catch (error) {
      log.error({ err: error }, 'Failed to create audit event')
      return reply.status(500).send({
        error: 'Failed to create audit event',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
