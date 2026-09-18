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
 * GET  /family/life-events                            — the tenant's declared events, most recent first
 * POST /family/life-events                            — report a new event, returns its rendered playbook
 * POST /family/life-events/:id/steps/:stepId/prepare  — draft an outreach message for one step (Tier 1 — never sends)
 * POST /family/life-events/:id/steps/:stepId/complete — persist checklist completion server-side
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

// Full Emergency-Mode taxonomy: the 5 crisis tiles (bereavement, medical,
// car, property, travel) plus job_loss/disability. Until this list covered
// all of them, the tiles routed to the hypothetical /events simulator —
// car, property, and travel had no real flow at all.
const LIFE_EVENT_TYPES = ['job_loss', 'bereavement', 'disability', 'medical', 'car', 'property', 'travel'] as const

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
    // Checklist completion (remediation item 19) — previously localStorage-
    // only on the web client, so checking off "call your insurer" on a phone
    // never showed on a laptop and was invisible to Oak entirely. Persisted
    // on the signal doc itself; only ids the currently-rendered playbook
    // actually contains are ever stored or returned.
    completed_step_ids?: string[]
  }
  created_at: Date
}

export function registerLifeEventRoutes(app: FastifyInstance, db: Db): void {
  const prepareLlmFn = createLlmRouterFromEnv()

  const profileFor = (tenantId: string) =>
    getTenantCollection<FinancialProfile & { tenant_id: string }>(db, 'family_financial_profile', tenantId)

  // Only ids present in the currently-rendered playbook count — a stored
  // id whose step no longer renders (playbook edit, different profile
  // shape) is filtered out of reads rather than resurfacing stale checks.
  const validCompletedIds = (doc: LifeEventSignalDoc, playbook: { steps: { id: string }[] } | null): string[] => {
    if (!playbook) return []
    const stepIds = new Set(playbook.steps.map((s) => s.id))
    return (doc.data.completed_step_ids ?? []).filter((id) => stepIds.has(id))
  }

  app.get('/family/life-events', async (req) => {
    const { tenant_id } = req.authContext
    const col = await getSignalsCollection()
    const docs = await col
      .find({ tenant_id, signal_type: 'family.life_event' })
      .sort({ created_at: -1 })
      .toArray() as unknown as LifeEventSignalDoc[]

    const profile = await profileFor(tenant_id).findOne({})

    return {
      events: docs.map((doc) => {
        const playbook = profile ? renderPlaybook(doc.data.event_type, profile, doc.data.affected_member_id) : null
        return {
          id: doc.id,
          event_type: doc.data.event_type,
          affected_member_id: doc.data.affected_member_id ?? null,
          reported_at: doc.data.reported_at,
          completed_step_ids: validCompletedIds(doc, playbook),
          playbook,
        }
      }),
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
        completed_step_ids: [],
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

  /**
   * Server-side checklist completion (remediation item 19). Body is an
   * explicit {done: boolean} rather than a blind toggle — two devices
   * racing the same step must converge on the same end state, which a
   * "flip whatever is there" semantic can't guarantee. The stepId is
   * validated against the currently-rendered playbook before anything is
   * stored, so a client can't write completion state for a step that
   * doesn't exist.
   */
  app.post<{ Params: { id: string; stepId: string }; Body: { done?: boolean } }>(
    '/family/life-events/:id/steps/:stepId/complete',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { id, stepId } = req.params
      const done = req.body?.done
      if (typeof done !== 'boolean') {
        return reply.status(400).send({ error: 'A boolean "done" field is required' })
      }

      const col = await getSignalsCollection()
      const doc = (await col.findOne({ tenant_id, signal_type: 'family.life_event', id })) as LifeEventSignalDoc | null
      if (!doc) return reply.status(404).send({ error: 'Life event not found' })

      const profile = await profileFor(tenant_id).findOne({})
      if (!profile) return reply.status(404).send({ error: 'No financial profile on file' })

      const playbook = renderPlaybook(doc.data.event_type, profile, doc.data.affected_member_id)
      if (!playbook.steps.some((s) => s.id === stepId)) {
        return reply.status(404).send({ error: 'Step not found' })
      }

      const op: Record<string, unknown> = done
        ? { $addToSet: { 'data.completed_step_ids': stepId } }
        : { $pull: { 'data.completed_step_ids': stepId } }
      await col.updateOne({ tenant_id, signal_type: 'family.life_event', id }, op)

      const stored = ((doc.data.completed_step_ids ?? []).filter((s) => s !== stepId))
      if (done) stored.push(stepId)
      return { completed_step_ids: validCompletedIds({ ...doc, data: { ...doc.data, completed_step_ids: stored } }, playbook) }
    },
  )
}
