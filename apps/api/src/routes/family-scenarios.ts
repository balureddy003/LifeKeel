/**
 * Saved "what if" scenarios (PRD-115).
 *
 * The assistant's /simulate endpoint computes a scenario and narrates it
 * once — nothing persisted, and before this route the only surface that
 * ever called it lived inside Ask Oak. This adds the durable half the
 * vision calls for ("proactive nudges and scenario simulations"): a
 * family can save the *inputs* of a scenario ("our income drops by £3,000
 * a month, starting in 6 months") and read it back later, always
 * recomputed against the live profile on read — never a frozen snapshot,
 * same posture as render-playbook.ts and /family/readiness.
 *
 *   POST /family/scenarios/preview   → run the math, persist nothing
 *                                       (sliders/previews, no LLM, cheap)
 *   POST /family/scenarios           → save { name, inputs }, returns the
 *                                       doc plus its freshly-computed result
 *   GET  /family/scenarios           → list, each recomputed on read
 *   GET  /family/scenarios/:id       → one, recomputed
 *   DELETE /family/scenarios/:id     → creator or any family adult
 *
 * A scenario whose inputs no longer map to a projectable profile (e.g.
 * income and expenses both cleared) returns result: null rather than a
 * number computed on nothing — same honesty rule as /simulate.
 *
 * Tier 0 — pure read/math plus scenario bookkeeping; no external effect.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getTenantCollection } from '@agentoak/platform'
import { isFamilyAdult } from '../lib/family-permissions.js'
import { calculateScenario, type ScenarioChange, type ScenarioResult } from '../scenarios/calculate.js'
import { toScenarioProfileInput } from '../scenarios/profile-input.js'
import type { FinancialProfile } from './family-financial-profile.js'

const ScenarioStepSchema = z.object({
  atMonth: z.number().int().min(0).max(360),
  monthlyIncomeDeltaMinor: z.number().int().optional(),
  monthlyExpenseDeltaMinor: z.number().int().optional(),
})

const ScenarioInputsSchema = z.object({
  monthlyIncomeDeltaMinor: z.number().int().optional(),
  monthlyExtraSavingsMinor: z.number().int().min(0).optional(),
  targetChildName: z.string().max(100).optional(),
  monthsUntilChange: z.number().int().min(0).max(360).optional(),
  // PRD-132: ordered regime changes ("income stops now, returns in 12
  // months"). Overrides the flat income-delta/horizon shorthand when
  // present; extra savings still applies throughout.
  steps: z.array(ScenarioStepSchema).max(12).optional(),
})

const CreateSchema = ScenarioInputsSchema.extend({
  name: z.string().min(1).max(120),
})

interface FamilyScenarioDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  name: string
  inputs: ScenarioChange
  created_by: string
  created_at: string
}

interface ScenarioView {
  id: string
  name: string
  inputs: ScenarioChange
  created_by: string
  created_at: string
  result: ScenarioResult | null
  has_live_data: boolean
}

export function registerFamilyScenarioRoutes(app: FastifyInstance, db: Db): void {
  const scenariosFor = (tenantId: string) => getTenantCollection<FamilyScenarioDoc>(db, 'family_scenarios', tenantId)

  const project = async (tenantId: string, inputs: ScenarioChange): Promise<{ result: ScenarioResult | null; has_live_data: boolean }> => {
    const profile = await getTenantCollection<FinancialProfile>(db, 'family_financial_profile', tenantId).findOne({})
    const input = toScenarioProfileInput(profile)
    if (!input) return { result: null, has_live_data: false }
    return { result: calculateScenario(input, inputs), has_live_data: true }
  }

  const toView = async (tenantId: string, doc: FamilyScenarioDoc): Promise<ScenarioView> => {
    const { result, has_live_data } = await project(tenantId, doc.inputs)
    return {
      id: doc.id,
      name: doc.name,
      inputs: doc.inputs,
      created_by: doc.created_by,
      created_at: doc.created_at,
      result,
      has_live_data,
    }
  }

  app.post<{ Body: z.infer<typeof ScenarioInputsSchema> }>('/family/scenarios/preview', async (req, reply) => {
    const parsed = ScenarioInputsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid scenario', issues: parsed.error.issues })
    }
    const { tenant_id } = req.authContext
    return reply.send(await project(tenant_id, parsed.data))
  })

  app.post<{ Body: z.infer<typeof CreateSchema> }>('/family/scenarios', async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid scenario', issues: parsed.error.issues })
    }
    const { tenant_id, user_id } = req.authContext
    const { name, ...inputs } = parsed.data
    const doc: FamilyScenarioDoc = {
      id: crypto.randomUUID(),
      tenant_id,
      name,
      inputs,
      created_by: user_id,
      created_at: new Date().toISOString(),
    }
    await scenariosFor(tenant_id).insertOne(doc)
    return reply.status(201).send({ scenario: await toView(tenant_id, doc) })
  })

  app.get('/family/scenarios', async (req) => {
    const { tenant_id } = req.authContext
    const docs = await scenariosFor(tenant_id).find({}).toArray()
    const scenarios = await Promise.all(
      (docs as FamilyScenarioDoc[])
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((d) => toView(tenant_id, d)),
    )
    return { scenarios }
  })

  app.get<{ Params: { id: string } }>('/family/scenarios/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const doc = await scenariosFor(tenant_id).findOne({ id: req.params.id })
    if (!doc) return reply.status(404).send({ error: 'Scenario not found' })
    return reply.send({ scenario: await toView(tenant_id, doc as FamilyScenarioDoc) })
  })

  // Deleting someone else's saved scenario is a real family-communication
  // touchpoint ("who removed the job-loss projection?"), so it's gated:
  // the creator, or any adult — children can't delete other members'.
  app.delete<{ Params: { id: string } }>('/family/scenarios/:id', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const col = scenariosFor(tenant_id)
    const doc = await col.findOne({ id: req.params.id })
    if (!doc) return reply.status(404).send({ error: 'Scenario not found' })
    const isCreator = (doc as FamilyScenarioDoc).created_by === user_id
    if (!isCreator && !(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Only the creator or a family adult can delete a saved scenario' })
    }
    await col.deleteOne({ id: req.params.id })
    return reply.status(204).send()
  })
}
