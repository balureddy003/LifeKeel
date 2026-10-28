/**
 * /keel/* — the signed-in user's inline agent panel.
 *
 * Identity comes only from req.authContext (set by the server's onRequest
 * hook: session verified, MFA-pending rejected, revocation and liveness
 * checked). No route accepts a tenant or user id, and ids that name stored
 * resources (threads, proposals) are looked up scoped to the caller, so
 * someone else's id is a uniform 404.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import { getAuditLogger } from '../audit/audit-log.js'
import { buildKeelContext, type KeelContext } from './context.js'
import { runTurn, type AssistantReply, type KeelEvent, type TurnInput } from './orchestrator.js'
import { confirmProposal, dismissProposal } from './proposals.js'
import { STEP_IDS, getSetupState, type StepId } from './setup-state.js'
import {
  appendMessage,
  deleteAllThreads,
  deleteThread,
  ensureThread,
  getThread,
  listThreads,
} from './threads.js'

export const keelAgentEnabled = (): boolean => process.env['KEEL_AGENT_ENABLED'] !== 'false'

const TurnBody = z.object({
  message: z.string().trim().min(1).max(2000),
  thread_id: z.string().uuid().optional(),
  page_context: z
    .object({
      route: z
        .string()
        .max(100)
        .regex(/^\/[a-z0-9\-/]*$/)
        .optional(),
      step: z
        .string()
        .max(32)
        .regex(/^[a-z-]+$/)
        .optional(),
      anchors: z
        .array(
          z
            .string()
            .max(64)
            .regex(/^[a-z0-9-]+$/),
        )
        .max(50)
        .optional(),
    })
    .optional(),
  member_id: z.string().max(100).optional(),
  medical_hint: z.boolean().optional(),
})

const NO_STORE = 'private, no-store'
const rateLimit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } })

type AskAssistant = (req: FastifyRequest, input: TurnInput) => Promise<AssistantReply>

/** Default: call the governed /assistant/ask in-process with the caller's own credentials. */
function injectAssistant(app: FastifyInstance): AskAssistant {
  return async (req, input) => {
    const h = req.headers
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    for (const k of [
      'authorization',
      'cookie',
      'origin',
      'user-agent',
      'x-forwarded-for',
    ] as const) {
      const v = h[k]
      if (typeof v === 'string') headers[k] = v
    }
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers,
      payload: {
        query: input.message,
        ...(input.member_id ? { member_id: input.member_id } : {}),
        ...(input.medical_hint ? { medical_hint: true } : {}),
      },
    })
    if (res.statusCode !== 200) throw new Error(`assistant ${res.statusCode}`)
    return res.json() as AssistantReply
  }
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: 'Not found' })
}

export function registerKeelRoutes(
  app: FastifyInstance,
  db: Db,
  opts: { askAssistant?: AskAssistant } = {},
): void {
  const ask = opts.askAssistant ?? injectAssistant(app)
  const audit = getAuditLogger

  const ctxOf = (req: FastifyRequest): Promise<KeelContext> => buildKeelContext(db, req.authContext)

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/keel/')) return
    if (!keelAgentEnabled()) return reply.status(404).send({ error: 'Not found' })
    void reply.header('Cache-Control', NO_STORE)
  })

  app.get('/keel/setup-state', rateLimit(60), async (req) => {
    const ctx = await ctxOf(req)
    return getSetupState(db, ctx)
  })

  app.post('/keel/turns', rateLimit(10), async (req, reply) => {
    const parsed = TurnBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' })
    const body = parsed.data
    const input: TurnInput = {
      message: body.message,
      ...(body.page_context?.route ? { route: body.page_context.route } : {}),
      ...(body.member_id ? { member_id: body.member_id } : {}),
      ...(body.medical_hint ? { medical_hint: true } : {}),
    }

    const wantsStream = String(req.headers.accept ?? '').includes('text/event-stream')
    const events: KeelEvent[] = []
    let closed = false
    let heartbeat: NodeJS.Timeout | undefined
    let held: Extract<KeelEvent, { type: 'done' }> | undefined

    const write = (e: KeelEvent) => {
      if (closed) return
      if (wantsStream) reply.raw.write(`event: keel\ndata: ${JSON.stringify(e)}\n\n`)
      else events.push(e)
    }
    // The terminal event is held until history is saved so it can carry the thread id.
    const emit = (e: KeelEvent) => (e.type === 'done' ? void (held = e) : write(e))

    if (wantsStream) {
      reply.hijack()
      reply.raw.writeHead(200, {
        ...(reply.getHeaders() as Record<string, string>),
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': NO_STORE,
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      heartbeat = setInterval(() => !closed && reply.raw.write(': keepalive\n\n'), 15_000)
      // The response closes when the client leaves; the request stream also closes once its body is read.
      reply.raw.on('close', () => {
        closed = true
        if (heartbeat) clearInterval(heartbeat)
      })
    }

    const started = Date.now()
    try {
      const outcome = await runTurn(
        {
          db,
          auth: req.authContext,
          askAssistant: (i) => ask(req, i),
        },
        input,
        emit,
      )

      let threadId: string | undefined
      if (outcome.transcript && !closed) {
        try {
          const ctx = await ctxOf(req)
          threadId = await ensureThread(db, ctx, body.thread_id, body.message)
          await appendMessage(db, ctx, threadId, { author: 'user', content: body.message })
          await appendMessage(db, ctx, threadId, {
            author: 'keel',
            content: outcome.transcript.content,
            answer_route: outcome.route,
            cards: outcome.transcript.cards,
            data_as_of: outcome.transcript.data_as_of,
          })
        } catch (err) {
          // History is a convenience; a failed save must not lose the answer.
          req.log.warn({ err }, 'Keel history save failed')
          threadId = undefined
        }
      }
      if (held) write({ ...held, ...(threadId ? { thread_id: threadId } : {}) })

      // Metadata only: route and timing, never the question or the answer.
      audit()?.fromRequest(req, 'keel.turn', 'keel', 'turn', {
        route: outcome.route,
        ms: Date.now() - started,
        streamed: wantsStream,
      })
    } catch (err) {
      req.log.error({ err }, 'Keel turn failed')
      write({ type: 'error', code: 'unavailable' })
      write({ type: 'done', route: 'fallback', is_live: false })
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }

    if (wantsStream) {
      if (!closed) reply.raw.end()
      return reply
    }
    const done = events.find((e) => e.type === 'done')
    return reply.send({
      events,
      thread_id: done && done.type === 'done' ? done.thread_id : undefined,
    })
  })

  // ── Proposals (Tier 1): the organizer applies with their own click ─────────

  const proposalId = z.string().uuid()

  app.post<{ Params: { id: string } }>(
    '/keel/proposals/:id/confirm',
    rateLimit(10),
    async (req, reply) => {
      if (!proposalId.safeParse(req.params.id).success) return notFound(reply)
      const ctx = await ctxOf(req)
      const result = await confirmProposal(db, ctx, req.params.id)
      if (result.ok) {
        audit()?.fromRequest(req, 'keel.proposal.applied', 'keel_proposal', req.params.id, {
          approvedBy: ctx.user_id,
        })
        return { ok: true }
      }
      if (result.code === 'not_found') {
        audit()?.fromRequest(req, 'keel.access_denied', 'keel_proposal', req.params.id, {
          reason: 'not_owner_or_expired',
        })
        return notFound(reply)
      }
      if (result.code === 'forbidden')
        return reply.status(403).send({ error: 'Only the household organizer can apply this.' })
      if (result.code === 'conflict')
        return reply
          .status(409)
          .send({
            error: 'Your settings changed since this was prepared. Ask Keel again for a fresh one.',
          })
      return reply.status(500).send({ error: 'Could not apply that right now.' })
    },
  )

  app.post<{ Params: { id: string } }>(
    '/keel/proposals/:id/dismiss',
    rateLimit(30),
    async (req, reply) => {
      if (!proposalId.safeParse(req.params.id).success) return notFound(reply)
      const ctx = await ctxOf(req)
      if (!(await dismissProposal(db, ctx, req.params.id))) return notFound(reply)
      audit()?.fromRequest(req, 'keel.proposal.dismissed', 'keel_proposal', req.params.id)
      return { ok: true }
    },
  )

  // ── Skip a step the household doesn't need (never counts as done) ─────────

  app.post<{ Params: { id: string } }>(
    '/keel/steps/:id/skip',
    rateLimit(30),
    async (req, reply) => {
      if (!(STEP_IDS as string[]).includes(req.params.id)) return notFound(reply)
      const ctx = await ctxOf(req)
      if (!ctx.hasFamily || ctx.isMinor) return notFound(reply)
      await getTenantCollection(db, 'keel_preferences', ctx.tenant_id).updateOne(
        { user_id: ctx.user_id },
        {
          $addToSet: { skipped_steps: req.params.id as StepId },
          $setOnInsert: { user_id: ctx.user_id },
        },
        { upsert: true },
      )
      return { ok: true }
    },
  )

  // ── Conversations: the caller's own, 30-day retention ─────────────────────

  app.get('/keel/threads', rateLimit(30), async (req) => ({
    threads: await listThreads(db, await ctxOf(req)),
  }))

  app.get<{ Params: { id: string } }>('/keel/threads/:id', rateLimit(30), async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return notFound(reply)
    const thread = await getThread(db, await ctxOf(req), req.params.id)
    if (!thread) {
      audit()?.fromRequest(req, 'keel.access_denied', 'keel_thread', randomUUID(), {
        reason: 'not_owner_or_expired',
      })
      return notFound(reply)
    }
    return thread
  })

  app.delete<{ Params: { id: string } }>('/keel/threads/:id', rateLimit(30), async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return notFound(reply)
    if (!(await deleteThread(db, await ctxOf(req), req.params.id))) return notFound(reply)
    return { ok: true }
  })

  app.delete('/keel/threads', rateLimit(10), async (req) => {
    await deleteAllThreads(db, await ctxOf(req))
    return { ok: true }
  })
}
