/**
 * PRD-108: life-event response playbooks.
 *
 * A life event is a fact the family reports ("I lost my job"), not a
 * threshold the engine infers — distinct from the existing detector
 * signal types, so this never calls engine.evaluate() and needs no
 * detector YAML. Persisted via the same persistSignal() every other
 * family signal goes through (apps/api/src/signals.ts), then rendered
 * against the family's real financial profile at read time — via
 * apps/api/src/life-events/render-playbook.ts — so the numbers shown
 * stay live rather than frozen at report time.
 *
 * GET  /family/life-events                          — the tenant's declared events, most recent first
 * POST /family/life-events                           — report a new event, returns its rendered playbook
 * POST /family/life-events/:id/steps/:stepId/prepare  — draft an outreach message for one step (Tier 1 — never sends)
 */
import crypto from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLlmRouterFromEnv, getTenantCollection } from '@agentoak/platform'
import { getSignalsCollection } from '../db.js'
import { persistSignal } from '../signals.js'
import { generateDraft } from '../insights/generate-draft.js'
import { renderPlaybook, type LifeEventType } from '../life-events/render-playbook.js'
import type { FinancialProfile } from './family-financial-profile.js'

const LIFE_EVENT_TYPES = ['job_loss', 'bereavement', 'disability'] as const

const ReportLifeEventSchema = z.object({
  event_type: z.enum(LIFE_EVENT_TYPES),
  affected_member_id: z.string().min(1).optional(),
})

interface LifeEventSignalDoc {
  id: string
  tenant_id: string
  signal_type: string
  data: {
    event_type: LifeEventType
    affected_member_id?: string
    reported_at: string
  }
  created_at: Date
}

export function registerLifeEventRoutes(app: FastifyInstance, db: Db): void {
  const prepareLlmFn = createLlmRouterFromEnv()

  const profileFor = (tenantId: string) =>
    getTenantCollection<FinancialProfile & { tenant_id: string }>(db, 'family_financial_profile', tenantId)

  app.get('/family/life-events', async (req) => {
    const { tenant_id } = req.authContext
    const col = await getSignalsCollection()
    const docs = await col
      .find({ tenant_id, signal_type: 'family.life_event' })
      .sort({ created_at: -1 })
      .toArray() as unknown as LifeEventSignalDoc[]

    const profile = await profileFor(tenant_id).findOne({})

    return {
      events: docs.map((doc) => ({
        id: doc.id,
        event_type: doc.data.event_type,
        affected_member_id: doc.data.affected_member_id ?? null,
        reported_at: doc.data.reported_at,
        playbook: profile ? renderPlaybook(doc.data.event_type, profile, doc.data.affected_member_id) : null,
      })),
    }
  })

  app.post<{ Body: { event_type: string; affected_member_id?: string } }>(
    '/family/life-events',
    async (req, reply) => {
      const parsed = ReportLifeEventSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid life event', issues: parsed.error.issues })
      }
      const { tenant_id } = req.authContext
      const { event_type, affected_member_id } = parsed.data

      const profile = await profileFor(tenant_id).findOne({})
      if (!profile) {
        return reply.status(400).send({ error: 'Submit a financial profile before reporting a life event' })
      }

      const id = crypto.randomUUID()
      const reported_at = new Date().toISOString()
      await persistSignal({
        id,
        tenant_id,
        signal_type: 'family.life_event',
        source: 'manual-entry',
        external_id: id,
        data: { event_type, ...(affected_member_id ? { affected_member_id } : {}), reported_at },
      })

      return reply.status(201).send({
        id,
        event_type,
        affected_member_id: affected_member_id ?? null,
        reported_at,
        playbook: renderPlaybook(event_type, profile, affected_member_id),
      })
    },
  )

  /**
   * Tier 1 "prepare, don't send" (docs/prd/103-tier1-prepare-actions.md),
   * reused: same generateDraft() LLM plumbing POST /insights/:id/prepare
   * uses, called directly with this step's own rendered text rather than
   * a persisted Insight document — a playbook step isn't detector output,
   * so it has no real detector_id/rule_id to borrow.
   */
  app.post<{ Params: { id: string; stepId: string } }>(
    '/family/life-events/:id/steps/:stepId/prepare',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { id, stepId } = req.params

      const col = await getSignalsCollection()
      const doc = (await col.findOne({ tenant_id, signal_type: 'family.life_event', id })) as LifeEventSignalDoc | null
      if (!doc) return reply.status(404).send({ error: 'Life event not found' })

      const profile = await profileFor(tenant_id).findOne({})
      if (!profile) return reply.status(404).send({ error: 'No financial profile on file' })

      const playbook = renderPlaybook(doc.data.event_type, profile, doc.data.affected_member_id)
      const step = playbook.steps.find((s) => s.id === stepId)
      if (!step || !step.contact) {
        return reply.status(404).send({ error: 'Step not found or not eligible for a draft' })
      }

      const content = await generateDraft(prepareLlmFn, {
        reasoning: step.body,
        category: 'life_event',
        detector_id: `family_life_event_${doc.data.event_type}`,
      })
      if (!content) {
        return reply.send({ draft: null, error: "Couldn't generate a draft right now — please try again later." })
      }
      return reply.send({ draft: { content, generated_at: new Date() } })
    },
  )
}
