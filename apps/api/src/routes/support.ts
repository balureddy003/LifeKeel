/**
 * Support Routes — the user-facing half of the AI-first support channel.
 *
 * POST /support/ask is the triage layer (Intercom-Fin pattern): Oak answers
 * product/account questions immediately, grounded only in light account
 * state — never the financial profile, since support questions aren't
 * financial questions and routing them through the profile would leak more
 * context to the LLM than the answer needs. Only when the user says the
 * answer didn't help does POST /support/cases create a human-visible case —
 * that ordering is what keeps the operator inbox signal-dense.
 *
 * Cases are user-scoped (support is personal, not household) and appear in
 * the operator console at /operator/support.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLlmRouterFromEnv, getTenantCollection, type LlmFn } from '@agentoak/platform'

const AskSchema = z.object({ question: z.string().trim().min(1).max(2000) })
const CreateCaseSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(1).max(4000),
  // The Ask-Oak conversation that preceded escalation — stored as 'oak'
  // messages so the operator sees what was already tried instead of
  // re-answering it.
  triage: z
    .array(z.object({ question: z.string().max(2000), answer: z.string().max(4000) }))
    .max(10)
    .optional(),
})
const MessageSchema = z.object({ text: z.string().trim().min(1).max(4000) })

export type SupportCaseStatus = 'open' | 'answered' | 'resolved'

export interface SupportMessage {
  id: string
  author: 'user' | 'operator' | 'oak'
  author_id?: string
  author_name?: string
  text: string
  created_at: Date
}

export interface SupportCaseDoc {
  id: string
  user_id: string
  tenant_id: string
  email: string
  subject: string
  status: SupportCaseStatus
  ai_triaged: boolean
  messages: SupportMessage[]
  created_at: Date
  updated_at: Date
  resolved_by?: string
  resolved_at?: Date
}

const SUPPORT_PROMPT = `You are Oak, the in-app support assistant for Agent Oak — a family's financial digital twin. You answer product and account questions before a human teammate sees them.

What Agent Oak does:
- Household financial profile: income, expenses, policies, education funds, retirement targets — entered in Financial Profile, confirmed per-member.
- Insights: Oak flags specific gaps (e.g. an education fund nearing its target date) as Insights in the app.
- Assistant: the family can ask Oak questions grounded in their own profile.
- Documents: uploaded statements/policies are extracted and suggested as profile updates; the family confirms before they're applied.
- Family: members join via invite codes; each confirms their own details.
- Billing: Oak Plus subscriptions and credit-based usage are managed in Settings.

Rules:
- Answer only product/how-to/account questions. Never give financial, investment, insurance, tax, or legal advice and never recommend or compare specific products or providers — that line is permanent, not a support decision. If a question needs that, say a licensed professional is the right next step.
- You cannot change anything on the account — no billing adjustments, deletions, suspensions, password resets, or profile edits. For those, say plainly that a human teammate will handle it and tell the user to open a support case below.
- If you don't know, say so and suggest opening a case rather than guessing.
- Be concise — 2–4 short sentences unless the steps genuinely need more.`

const ASK_FALLBACK = "I couldn't reach my answer service just now. If this is urgent, open a support case below and a teammate will pick it up."

export function registerSupportRoutes(app: FastifyInstance, db: Db): void {
  const llmFn: LlmFn = createLlmRouterFromEnv()
  const cases = db.collection<SupportCaseDoc>('support_cases')
  const users = db.collection('users')

  cases.createIndex({ user_id: 1, updated_at: -1 }).catch(() => {})

  app.post<{ Body: { question?: string } }>(
    '/support/ask',
    // Same dedicated LLM-spend limit as /assistant/ask.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = AskSchema.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
      const { tenant_id, user_id } = req.authContext

      // Light account context — enough for "am I on the right plan?" style
      // questions, deliberately not the financial profile.
      const [user, tenant] = await Promise.all([
        users.findOne({ id: user_id }, { projection: { name: 1 } }),
        db.collection('tenants').findOne({ tenant_id }, { projection: { plan: 1, name: 1 } }),
      ])
      const context = `Account: plan ${(tenant?.['plan'] as string) ?? 'free'}, workspace "${(tenant?.['name'] as string) ?? tenant_id}".`
      try {
        const content = await llmFn(SUPPORT_PROMPT, `${context}\n\nQuestion from ${(user?.['name'] as string) ?? 'the user'}: ${parsed.data.question}`, 'tier:fast')
        return reply.send({ answer: content, isLive: true })
      } catch (err) {
        req.log.warn({ err }, 'Support triage LLM call failed — falling back')
        return reply.send({ answer: ASK_FALLBACK, isLive: false })
      }
    },
  )

  app.post<{ Body: unknown }>('/support/cases', async (req, reply) => {
    const parsed = CreateCaseSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
    const { tenant_id, user_id } = req.authContext
    const { subject, message, triage } = parsed.data

    const user = await users.findOne({ id: user_id }, { projection: { email: 1, name: 1 } })
    const now = new Date()
    const messages: SupportMessage[] = []
    // Triage transcript first so the thread reads chronologically.
    for (const turn of triage ?? []) {
      messages.push(
        { id: randomUUID(), author: 'user', author_id: user_id, text: turn.question, created_at: now },
        { id: randomUUID(), author: 'oak', text: turn.answer, created_at: now },
      )
    }
    messages.push({ id: randomUUID(), author: 'user', author_id: user_id, author_name: (user?.['name'] as string) ?? undefined, text: message, created_at: now })

    const doc: SupportCaseDoc = {
      id: randomUUID(),
      user_id,
      tenant_id,
      email: ((user?.['email'] as string) ?? '').toLowerCase(),
      subject,
      status: 'open',
      ai_triaged: (triage?.length ?? 0) > 0,
      messages,
      created_at: now,
      updated_at: now,
    }
    await cases.insertOne(doc as never)
    return reply.status(201).send({ case: doc })
  })

  app.get('/support/cases', async (req) => {
    const { user_id } = req.authContext
    const items = await cases
      .find({ user_id }, { projection: { _id: 0 } })
      .sort({ updated_at: -1 })
      .limit(50)
      .toArray()
    return { cases: items }
  })

  app.get<{ Params: { id: string } }>('/support/cases/:id', async (req, reply) => {
    const { user_id } = req.authContext
    const doc = await cases.findOne({ id: req.params.id, user_id }, { projection: { _id: 0 } })
    if (!doc) return reply.status(404).send({ error: 'Case not found' })
    return { case: doc }
  })

  /** User follow-up on their own case — any reply reopens a resolved case so
   *  the operator inbox sees it again. */
  app.post<{ Params: { id: string }; Body: unknown }>('/support/cases/:id/messages', async (req, reply) => {
    const parsed = MessageSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
    const { user_id } = req.authContext
    const user = await users.findOne({ id: user_id }, { projection: { name: 1 } })
    const now = new Date()
    const message: SupportMessage = {
      id: randomUUID(),
      author: 'user',
      author_id: user_id,
      author_name: (user?.['name'] as string) ?? undefined,
      text: parsed.data.text,
      created_at: now,
    }
    const result = await cases.updateOne(
      { id: req.params.id, user_id },
      { $push: { messages: message }, $set: { status: 'open', updated_at: now }, $unset: { resolved_by: '', resolved_at: '' } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Case not found' })
    return { ok: true }
  })
}
