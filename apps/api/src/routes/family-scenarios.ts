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
import { toScenarioProfileInput, type MemberScope } from '../scenarios/profile-input.js'
import type { FinancialProfile } from './family-financial-profile.js'
import type { FamilyGroupDoc } from './family-group.js'

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
  // G7: scope the scenario to one roster member — "what happens to MY
  // income" for a second earner, not only the household aggregate. When
  // set, the projection runs on that member's earner slice and their
  // linked education funds; the shared emergency pool and household
  // expenses stay as-is (they're joint by nature).
  member_id: z.string().min(1).optional(),
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
  // G7: resolved display name of the scoped member, so the list can say
  // "Priya's income stops" without every client re-joining the roster.
  // null = household scope.
  member_name: string | null
  created_by: string
  created_at: string
  result: ScenarioResult | null
  has_live_data: boolean
}

type ProjectOutcome =
  | { status: 'ok'; result: ScenarioResult | null; has_live_data: boolean }
  | { status: 'bad_member' }

export function registerFamilyScenarioRoutes(app: FastifyInstance, db: Db): void {
  const scenariosFor = (tenantId: string) => getTenantCollection<FamilyScenarioDoc>(db, 'family_scenarios', tenantId)

  const project = async (
    tenantId: string,
    inputs: ScenarioChange,
  ): Promise<{ outcome: ProjectOutcome; memberName: string | null }> => {
    const profile = await getTenantCollection<FinancialProfile>(db, 'family_financial_profile', tenantId).findOne({})
    let memberScope: MemberScope | undefined
    let memberName: string | null = null
    if (inputs.member_id) {
      const family = await getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId).findOne({})
      const member = family?.members.find((m) => m.id === inputs.member_id)
      // An unknown id is a client bug, not a data gap — refuse rather
      // than silently running a household projection under a member's name.
      if (!member) return { outcome: { status: 'bad_member' }, memberName: null }
      memberName = member.name
      memberScope = { member_id: inputs.member_id, is_organizer: member.role === 'organizer' }
    }
    const input = toScenarioProfileInput(profile, memberScope)
    if (!input) return { outcome: { status: 'ok', result: null, has_live_data: false }, memberName }
    return { outcome: { status: 'ok', result: calculateScenario(input, inputs), has_live_data: true }, memberName }
  }

  const toView = async (tenantId: string, doc: FamilyScenarioDoc): Promise<ScenarioView> => {
    const { outcome, memberName } = await project(tenantId, doc.inputs)
    // A scenario saved against a member who was later removed can't be
    // projected honestly — report it as dataless, not wrong.
    const ok = outcome.status === 'ok'
    return {
      id: doc.id,
      name: doc.name,
      inputs: doc.inputs,
      member_name: memberName,
      created_by: doc.created_by,
      created_at: doc.created_at,
      result: ok ? outcome.result : null,
      has_live_data: ok ? outcome.has_live_data : false,
    }
  }

  app.post<{ Body: z.infer<typeof ScenarioInputsSchema> }>('/family/scenarios/preview', async (req, reply) => {
    const parsed = ScenarioInputsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid scenario', issues: parsed.error.issues })
    }
    const { tenant_id } = req.authContext
    const { outcome } = await project(tenant_id, parsed.data)
    if (outcome.status === 'bad_member') {
      return reply.status(400).send({ error: 'Family member not found for member_id' })
    }
    return reply.send({ result: outcome.result, has_live_data: outcome.has_live_data })
  })

  app.post<{ Body: z.infer<typeof CreateSchema> }>('/family/scenarios', async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid scenario', issues: parsed.error.issues })
    }
    const { tenant_id, user_id } = req.authContext
    const { name, ...inputs } = parsed.data
    if (inputs.member_id) {
      // Fail the save, not the later read — a scenario scoped to a
      // member who isn't on the roster can never project correctly.
      const family = await getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenant_id).findOne({})
      if (!family?.members.some((m) => m.id === inputs.member_id)) {
        return reply.status(400).send({ error: 'Family member not found for member_id' })
      }
    }
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
