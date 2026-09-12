/**
 * Execution Events — Real-time workflow execution event streaming.
 *
 * Phase 1 Feature: Real-Time Execution Log
 *
 * Routes:
 *   GET  /workflows/runs/:id/events  — Get execution events for a workflow run
 *   GET  /workflows/runs/:id/stream  — SSE stream for live event streaming
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'execution-events', version: '0.0.0' })

// ── Schema ─────────────────────────────────────────────────────────────────────

const ExecutionEventSchema = z.object({
  id: z.string(),
  workflow_run_id: z.string(),
  timestamp: z.string(),
  type: z.enum(['thought', 'tool_call', 'action', 'verification']),
  content: z.string(),
  tool: z.string().optional(),
  result: z.any().optional(),
  metadata: z.record(z.any()).optional(),
})

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>

// ── Route Handlers ─────────────────────────────────────────────────────────────

export async function registerExecutionEventRoutes(app: FastifyInstance, db: Db) {
  // Create collection and indexes
  const col = db.collection<ExecutionEvent>('execution_events')
  col.createIndex({ workflow_run_id: 1, timestamp: -1 }).catch(() => {})
  col.createIndex({ workflow_run_id: 1, type: 1 }).catch(() => {})

  // ── GET /workflows/runs/:id/events ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/workflows/runs/:id/events', async (req, reply) => {
    const { id: workflowRunId } = req.params

    const { limit = 100, offset = 0, type } = req.query as {
      limit?: number
      offset?: number
      type?: string
    }

    const filter: any = { workflow_run_id: workflowRunId }
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
      log.error({ err: error }, 'Failed to fetch execution events')
      return reply.status(500).send({
        error: 'Failed to fetch execution events',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── GET /workflows/runs/:id/stream ───────────────────────────────────────────
  // SSE stream for live event streaming (consistent with existing /events/stream)
  app.get<{ Params: { id: string } }>('/workflows/runs/:id/stream', async (req, reply) => {
    const { id: workflowRunId } = req.params

    // Set SSE headers
    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')

    // Send existing events first
    try {
      const existingEvents = await col
        .find({ workflow_run_id: workflowRunId })
        .sort({ timestamp: 1 })
        .toArray()

      reply.raw.write(`data: ${JSON.stringify({ type: 'history', events: existingEvents })}\n\n`)

      // TODO: Set up MongoDB change stream to send new events in real-time
      // For now, send a keep-alive comment every 30 seconds
      const keepAlive = setInterval(() => {
        reply.raw.write(': keep-alive\n\n')
      }, 30000)

      req.raw.on('close', () => {
        clearInterval(keepAlive)
      })

      // Send completion signal
      reply.raw.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`)
    } catch (error) {
      log.error({ err: error }, 'Failed to stream execution events')
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n\n`)
    }
  })

  // ── POST /workflows/runs/:id/events ───────────────────────────────────────────
  // Internal endpoint to create execution events (called by workflow engine)
  app.post<{ Params: { id: string } }>('/workflows/runs/:id/events', async (req, reply) => {
    const { id: workflowRunId } = req.params

    const parsed = ExecutionEventSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid execution event',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const event: ExecutionEvent = {
      ...parsed.data,
      workflow_run_id: workflowRunId,
      timestamp: parsed.data.timestamp || new Date().toISOString(),
    }

    try {
      await col.insertOne(event)

      // TODO: Broadcast to SSE clients via change stream
      // This requires a change stream connection manager

      return reply.status(201).send({ event })
    } catch (error) {
      log.error({ err: error }, 'Failed to create execution event')
      return reply.status(500).send({
        error: 'Failed to create execution event',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
