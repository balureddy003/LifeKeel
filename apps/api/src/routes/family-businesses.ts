/**
 * /family/businesses — the businesses a household member runs and the income each pays the household
 * (intent 96). GET returns the graph plus, for each business, what the household's estimate says if that
 * business stops. PUT replaces the graph.
 *
 * Access: adults in the family only (`canSeeEngineOutput`), fails closed. Tier 0: no model call, nothing
 * leaves the house. Output is information and an estimate, never a product or a "buy".
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { NO_END } from '../resilience/cashflow.js'
import { businessShockEvents, type BusinessGraph } from '../resilience/business-graph.js'
import { loadGraph, saveGraph } from '../resilience/business-graph-store.js'
import { describeRange, runwayRange } from '../resilience/range.js'
import { canSeeEngineOutput, type VisibilityMember } from '../resilience/visibility.js'

interface ProfileShape {
  household?: { monthly_salary_minor?: number; income_protection_monthly_minor?: number }
  emergency_fund?: { emergency_savings_minor?: number; monthly_expenses_minor?: number }
}
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0
type Family = { members?: (VisibilityMember & { name?: string })[] } | null

export interface BusinessShock {
  businessId: string
  name: string
  range: { lowMonths: number | null; highMonths: number | null }
  text: string
}

/** One estimate per business that pays the household something. Empty when the core figures are missing. */
export function buildBusinessShocks(
  profile: ProfileShape | null,
  graph: BusinessGraph,
): BusinessShock[] {
  const savings = profile?.emergency_fund?.emergency_savings_minor
  const spend = profile?.emergency_fund?.monthly_expenses_minor
  const income = profile?.household?.monthly_salary_minor
  if (!positive(savings) || !positive(spend) || !positive(income)) return []
  const open = (n: number) => (n >= NO_END ? null : n)
  const shocks: BusinessShock[] = []
  for (const b of graph.businesses) {
    const events = businessShockEvents(graph, b.id, 0)
    if (events.length === 0) continue
    const r = runwayRange({
      savingsMinor: savings,
      monthlyInflowMinor: income,
      monthlySpendMinor: spend,
      events,
    })
    shocks.push({
      businessId: b.id,
      name: b.name,
      range: { lowMonths: open(r.lowMonths), highMonths: open(r.highMonths) },
      text: describeRange(r),
    })
  }
  return shocks
}

export function registerFamilyBusinessesRoutes(app: FastifyInstance, db: Db): void {
  const load = async (tenant_id: string) => {
    const family = (await db.collection('family_groups').findOne({ tenant_id })) as Family
    const profile = (await db
      .collection('family_financial_profile')
      .findOne({ tenant_id })) as ProfileShape | null
    return { members: family?.members ?? [], profile }
  }

  app.get('/family/businesses', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const { members, profile } = await load(tenant_id)
    if (!canSeeEngineOutput(members, user_id))
      return reply.status(403).send({ error: 'Only adults in this family can see this' })
    const graph = await loadGraph(db, tenant_id)
    return {
      ...graph,
      adults: members
        .filter((m) => canSeeEngineOutput(members, m.id))
        .map((m) => ({ id: m.id, name: m.name ?? 'An adult' })),
      shocks: buildBusinessShocks(profile, graph),
    }
  })

  app.put('/family/businesses', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const { members } = await load(tenant_id)
    if (!canSeeEngineOutput(members, user_id))
      return reply.status(403).send({ error: 'Only adults in this family can change this' })
    const body = req.body as Partial<BusinessGraph> | null
    const graph: BusinessGraph = {
      businesses: Array.isArray(body?.businesses) ? body.businesses : [],
      incomeEdges: Array.isArray(body?.incomeEdges) ? body.incomeEdges : [],
    }
    const adultIds = new Set(
      members.filter((m) => canSeeEngineOutput(members, m.id)).map((m) => m.id),
    )
    if (graph.incomeEdges.some((e) => !adultIds.has(e.memberId)))
      return reply.status(400).send({ error: 'Income can only be paid to an adult in the family' })
    try {
      await saveGraph(db, tenant_id, graph)
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid' })
    }
    return { ok: true }
  })
}
