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
 * GET  /family/events/:eventId/readiness              — real readiness for a /events "What If?" scenario
 * GET  /family/life-events                            — the tenant's declared events, most recent first
 * POST /family/life-events                            — report a new event, returns its rendered playbook
 * POST /family/life-events/:id/steps/:stepId/prepare  — draft an outreach message for one step (Tier 1 — never sends)
 * POST /family/life-events/:id/steps/:stepId/complete — persist checklist completion server-side
 * GET  /family/life-events/nudge                       — PRD-111: is an unreported-life-change nudge active
 * POST /family/life-events/nudge/dismiss                — PRD-111: dismiss it
 */
import crypto from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import { taskLlm } from '../ai/task-gateway.js'
import { getSignalsCollection, getLifeChangeNudgeStateCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { persistSignal } from '../signals.js'
import { generateDraft, generatePrepNote } from '../insights/generate-draft.js'
import { extractDraftProvenance } from '../insights/draft-provenance.js'
import { renderPlaybook, type LifeEventType } from '../life-events/render-playbook.js'
import { computeEventReadiness } from '../life-events/event-readiness.js'
import { maybeSendVaultReminder } from '../life-events/vault-reminder.js'
import { recordInsightAction } from '../insights/insight-attribution.js'
import type { FinancialProfile } from './family-financial-profile.js'

// Full Emergency-Mode taxonomy: the 5 crisis tiles (bereavement, medical,
// car, property, travel) plus job_loss/disability. Until this list covered
// all of them, the tiles routed to the hypothetical /events simulator —
// car, property, and travel had no real flow at all.
const LIFE_EVENT_TYPES = [
  'job_loss',
  'bereavement',
  'disability',
  'medical',
  'car',
  'property',
  'travel',
] as const

const ReportLifeEventSchema = z.object({
  event_type: z.enum(LIFE_EVENT_TYPES),
  affected_member_id: z.string().min(1).optional(),
  // G6: free-text context in the reporter's own words — "Mum's at County
  // Hospital, kids need pickup Thursday". Stored verbatim on the signal,
  // shown to other family members reading the event, and fed to Ask Keel's
  // grounding so crisis questions answer against what the family actually
  // said, not just the event type. Never parsed, never used to infer.
  context: z.string().max(2000).optional(),
})

interface LifeEventSignalDoc {
  id: string
  tenant_id: string
  signal_type: string
  data: {
    event_type: LifeEventType
    affected_member_id?: string
    reported_at: string
    // Who reported it — needed so checklist-reminder.ts's cron can nudge
    // the reporter specifically (not every adult, unlike vault-reminder)
    // without re-deriving it from context it no longer has by then.
    reported_by_user_id?: string
    // G6: the reporter's own free-text account of the situation.
    context?: string
    // Checklist completion (remediation item 19) — previously localStorage-
    // only on the web client, so checking off "call your insurer" on a phone
    // never showed on a laptop and was invisible to Keel entirely. Persisted
    // on the signal doc itself; only ids the currently-rendered playbook
    // actually contains are ever stored or returned.
    completed_step_ids?: string[]
    // checklist-reminder.ts's dedupe flag — one reminder ever per event.
    checklist_reminder_sent?: boolean
  }
  created_at: Date
}

export function registerLifeEventRoutes(app: FastifyInstance, db: Db): void {
  const profileFor = (tenantId: string) =>
    getTenantCollection<FinancialProfile & { tenant_id: string }>(
      db,
      'family_financial_profile',
      tenantId,
    )

  // Only ids present in the currently-rendered playbook count — a stored
  // id whose step no longer renders (playbook edit, different profile
  // shape) is filtered out of reads rather than resurfacing stale checks.
  const validCompletedIds = (
    doc: LifeEventSignalDoc,
    playbook: { steps: { id: string }[] } | null,
  ): string[] => {
    if (!playbook) return []
    const stepIds = new Set(playbook.steps.map((s) => s.id))
    return (doc.data.completed_step_ids ?? []).filter((id) => stepIds.has(id))
  }

  app.get('/family/life-events', async (req) => {
    const { tenant_id } = req.authContext
    const col = await getSignalsCollection()
    const docs = (await col
      .find({ tenant_id, signal_type: 'family.life_event' })
      .sort({ created_at: -1 })
      .toArray()) as unknown as LifeEventSignalDoc[]

    const profile = await profileFor(tenant_id).findOne({})

    return {
      events: docs.map((doc) => {
        const playbook = profile
          ? renderPlaybook(doc.data.event_type, profile, doc.data.affected_member_id)
          : null
        return {
          id: doc.id,
          event_type: doc.data.event_type,
          affected_member_id: doc.data.affected_member_id ?? null,
          reported_at: doc.data.reported_at,
          completed_step_ids: validCompletedIds(doc, playbook),
          context: doc.data.context ?? null,
          playbook,
        }
      }),
    }
  })

  /**
   * Real readiness for a /events "What If?" hypothetical scenario —
   * event-readiness.ts's pure-arithmetic formulas, reused from this file
   * (not a life-event route conceptually) because it needs the exact same
   * `profileFor` lookup every route here already has. Registered under
   * /family/events/ rather than /family/life-events/ on purpose: these
   * are two separate features (a hypothetical preview vs. a real, tracked
   * report) and the URL should say so, even though the computation is
   * shared. No profile at all is the only true "sample" case — everything
   * else either has real data or is honest that it doesn't (hasLiveData).
   */
  app.get<{ Params: { eventId: string } }>(
    '/family/events/:eventId/readiness',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const profile = await profileFor(tenant_id).findOne({})
      if (!profile) return reply.send({ hasLiveData: false })
      return reply.send(computeEventReadiness(req.params.eventId, profile))
    },
  )

  app.post<{ Body: { event_type: string; affected_member_id?: string; context?: string } }>(
    '/family/life-events',
    async (req, reply) => {
      const parsed = ReportLifeEventSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid life event', issues: parsed.error.issues })
      }
      const { tenant_id } = req.authContext
      const { event_type, affected_member_id, context } = parsed.data

      const profile = await profileFor(tenant_id).findOne({})
      if (!profile) {
        return reply
          .status(400)
          .send({ error: 'Submit a financial profile before reporting a life event' })
      }

      const id = crypto.randomUUID()
      const reported_at = new Date().toISOString()
      await persistSignal({
        id,
        tenant_id,
        signal_type: 'family.life_event',
        source: 'manual-entry',
        external_id: id,
        data: {
          event_type,
          ...(affected_member_id ? { affected_member_id } : {}),
          ...(context?.trim() ? { context: context.trim() } : {}),
          reported_at,
          reported_by_user_id: req.authContext.user_id,
        },
      })

      // PRD-111: reporting any life event is the family acting on their
      // own initiative — clear a pending unreported-life-change nudge
      // (if one was active) rather than leave it dangling now that
      // there's a real report on file. Distinct audit action from a
      // silent dismiss: this is the "nudge actually worked" signal.
      const nudgeState = await getLifeChangeNudgeStateCollection(db).findOne({
        tenant_id,
        active: true,
      })
      if (nudgeState) {
        await getLifeChangeNudgeStateCollection(db).updateOne(
          { tenant_id },
          { $set: { active: false } },
        )
        getAuditLogger()?.fromRequest(
          req,
          'life_event.nudge_acted_on',
          'life_event_nudge',
          tenant_id,
        )
      }

      const playbook = renderPlaybook(event_type, profile, affected_member_id)

      // Crisis-release re-scope (see the plan): a Tier-3 notification, not
      // an autonomous release — every adult already has standing vault
      // access (isFamilyAdult). Fire-and-forget: a family reporting a real
      // life event shouldn't wait on (or fail because of) an email send.
      maybeSendVaultReminder(
        db,
        tenant_id,
        event_type,
        id,
        req.authContext.user_id,
        playbook.title,
      ).catch((err) => req.log.error({ err, id }, 'Vault reminder check failed'))

      return reply.status(201).send({
        id,
        event_type,
        affected_member_id: affected_member_id ?? null,
        reported_at,
        completed_step_ids: [],
        context: context?.trim() ?? null,
        playbook,
      })
    },
  )

  /**
   * Tier 1 "prepare, don't send" (docs/prd/103-tier1-prepare-actions.md),
   * reused: same generateDraft()/generatePrepNote() LLM plumbing
   * POST /insights/:id/prepare uses, called directly with this step's own
   * rendered text rather than a persisted Insight document — a playbook
   * step isn't detector output, so it has no real detector_id/rule_id to
   * borrow.
   *
   * Every step is eligible now, not just contact:true ones — a step with
   * no one to email (e.g. job-loss's "Review your budget") previously had
   * no prepare affordance at all, even though Keel already has the real
   * numbers to help start it. `step.contact` picks which prompt applies
   * (an outreach email vs. a starting-point note); the eligibility gate
   * itself only checks the step actually exists.
   */
  app.post<{ Params: { id: string; stepId: string } }>(
    '/family/life-events/:id/steps/:stepId/prepare',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { id, stepId } = req.params

      const col = await getSignalsCollection()
      const doc = (await col.findOne({
        tenant_id,
        signal_type: 'family.life_event',
        id,
      })) as LifeEventSignalDoc | null
      if (!doc) return reply.status(404).send({ error: 'Life event not found' })

      const profile = await profileFor(tenant_id).findOne({})
      if (!profile) return reply.status(404).send({ error: 'No financial profile on file' })

      const playbook = renderPlaybook(doc.data.event_type, profile, doc.data.affected_member_id)
      const step = playbook.steps.find((s) => s.id === stepId)
      if (!step) {
        return reply.status(404).send({ error: 'Step not found' })
      }

      const prepareLlmFn = taskLlm('draft.outreach.v1', tenant_id)
      const content = step.contact
        ? await generateDraft(prepareLlmFn, {
            reasoning: step.body,
            category: 'life_event',
            detector_id: `family_life_event_${doc.data.event_type}`,
          })
        : await generatePrepNote(prepareLlmFn, { title: step.title, body: step.body })
      if (!content) {
        return reply.send({
          draft: null,
          error: "Couldn't generate a draft right now — please try again later.",
        })
      }
      // Same provenance contract as /insights/:id/prepare — step.body is the
      // personalized source text the model was grounded on here.
      return reply.send({
        draft: {
          content,
          generated_at: new Date(),
          provenance: extractDraftProvenance(step.body, content),
        },
      })
    },
  )

  /**
   * PRD-113: audit-only. Fired (fire-and-forget) by the client after an
   * on-device draft attempt — no draft content or step body in the
   * request, just a metadata-only outcome enum so the feature's coverage
   * and abstention rates are observable the same way every other action
   * is, without compromising the privacy property it exists for.
   */
  const ON_DEVICE_OUTCOMES = new Set([
    'generated',
    'template_fallback',
    'abstained',
    'guard_rejected',
    'unavailable',
    'error',
  ])
  app.post<{
    Params: { id: string; stepId: string }
    Body: { outcome?: string }
  }>('/family/life-events/:id/steps/:stepId/prepare-on-device', async (req, reply) => {
    const outcome = req.body?.outcome
    getAuditLogger()?.fromRequest(
      req,
      'insight.prepare_on_device',
      'life_event_step',
      req.params.stepId,
      {
        outcome:
          typeof outcome === 'string' && ON_DEVICE_OUTCOMES.has(outcome) ? outcome : 'generated', // legacy callers sent no body — treat as success
      },
    )
    return reply.send({ ok: true })
  })

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
      const doc = (await col.findOne({
        tenant_id,
        signal_type: 'family.life_event',
        id,
      })) as LifeEventSignalDoc | null
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

      // Insight→action attribution: checking off a playbook step is a
      // real action on whatever flagged it — recorded against the ambient
      // window, same posture as a profile save.
      if (done) {
        await recordInsightAction(db, tenant_id, 'step_completed').catch(() => {})
      }

      const stored = (doc.data.completed_step_ids ?? []).filter((s) => s !== stepId)
      if (done) stored.push(stepId)
      return {
        completed_step_ids: validCompletedIds(
          { ...doc, data: { ...doc.data, completed_step_ids: stored } },
          playbook,
        ),
      }
    },
  )

  // PRD-111: `active` only. The trigger reason lives in
  // family_life_change_nudge_state for the audit log alone — never
  // returned here, so the nudge has no way to guess or name what
  // changed even by accident.
  app.get('/family/life-events/nudge', async (req) => {
    const { tenant_id } = req.authContext
    const state = await getLifeChangeNudgeStateCollection(db).findOne({ tenant_id })
    return { active: state?.active === true }
  })

  app.post('/family/life-events/nudge/dismiss', async (req) => {
    const { tenant_id } = req.authContext
    await getLifeChangeNudgeStateCollection(db).updateOne(
      { tenant_id },
      { $set: { active: false } },
      { upsert: true },
    )
    getAuditLogger()?.fromRequest(req, 'life_event.nudge_dismissed', 'life_event_nudge', tenant_id)
    return { ok: true }
  })
}
