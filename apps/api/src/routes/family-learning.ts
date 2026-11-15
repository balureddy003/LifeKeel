/**
 * /family/learning — opt in to share one coarse, anonymous band across households (intent 96).
 *
 * Gated off: these routes exist only when `learningGate` is open (flag plus a recorded privacy review).
 * CLAUDE.md rule 3 stays in force: nothing here trains a model, and no family content leaves the household.
 * What may be shared is one band of months ("3-6"), no figures, no names, and only when EVERY adult in the
 * household has opted in. Any one adult withdrawing deletes the household's contribution at once. A cohort
 * is only shown above a minimum size, as counts, with small cells suppressed (`aggregateCohort`).
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { aggregateCohort, bandOf, MIN_COHORT, type Band } from '../learning/cohort.js'
import type { LearningGate } from '../learning/gate.js'
import { canSeeEngineOutput, type VisibilityMember } from '../resilience/visibility.js'
import { buildResilienceView } from './family-resilience.js'

type Family = { members?: (VisibilityMember & { name?: string })[] } | null

export function registerFamilyLearningRoutes(
  app: FastifyInstance,
  db: Db,
  opts: { gate: LearningGate; minCohort?: number },
): void {
  if (!opts.gate.open) return
  const minCohort = opts.minCohort ?? MIN_COHORT
  const consents = db.collection('learning_consent')
  const contributions = db.collection('learning_contributions')

  const adultsOf = async (tenant_id: string) => {
    const family = (await db.collection('family_groups').findOne({ tenant_id })) as Family
    const members = family?.members ?? []
    return {
      members,
      adults: members.filter((m) => canSeeEngineOutput(members, m.id)),
    }
  }

  app.get('/family/learning', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const { members, adults } = await adultsOf(tenant_id)
    if (!canSeeEngineOutput(members, user_id))
      return reply.status(403).send({ error: 'Only adults in this family can see this' })
    const rows = await consents.find({ tenant_id }).toArray()
    const optedIds = new Set(rows.map((r) => r['member_id'] as string))
    return {
      optedIn: optedIds.has(user_id),
      adultsOptedIn: adults.filter((a) => optedIds.has(a.id)).length,
      adultsTotal: adults.length,
      contributing: (await contributions.findOne({ tenant_id })) !== null,
    }
  })

  app.put('/family/learning', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const { members, adults } = await adultsOf(tenant_id)
    if (!canSeeEngineOutput(members, user_id))
      return reply.status(403).send({ error: 'Only adults in this family can change this' })
    const optIn = (req.body as { optIn?: unknown } | null)?.optIn === true

    if (!optIn) {
      // Withdrawal is immediate and total for the household: this adult's consent and the contribution.
      await consents.deleteOne({ tenant_id, member_id: user_id })
      await contributions.deleteMany({ tenant_id })
      return { ok: true }
    }

    const profile = await db.collection('family_financial_profile').findOne({ tenant_id })
    const view = buildResilienceView(profile as Parameters<typeof buildResilienceView>[0])
    if (view.status !== 'ready')
      return reply.status(400).send({ error: 'Enter your savings, spend and income first' })
    await consents.replaceOne(
      { tenant_id, member_id: user_id },
      { tenant_id, member_id: user_id, opted_in_at: new Date() },
      { upsert: true },
    )
    const optedIds = new Set(
      (await consents.find({ tenant_id }).toArray()).map((r) => r['member_id'] as string),
    )
    if (adults.length > 0 && adults.every((a) => optedIds.has(a.id))) {
      // The only thing stored: the household key (for deletion on withdrawal) and one coarse band.
      await contributions.replaceOne(
        { tenant_id },
        { tenant_id, band: bandOf(view.range.lowMonths), recorded_at: new Date() },
        { upsert: true },
      )
    }
    return { ok: true }
  })

  app.get('/family/learning/benchmark', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const { members } = await adultsOf(tenant_id)
    if (!canSeeEngineOutput(members, user_id))
      return reply.status(403).send({ error: 'Only adults in this family can see this' })
    // Reciprocity: you only see the cohort if your own household contributes to it.
    if (!(await contributions.findOne({ tenant_id })))
      return reply.status(403).send({ error: 'Opt in, with every adult, to see this' })
    const all = await contributions.find({}).toArray()
    const summary = aggregateCohort(
      all.map((d) => d['band'] as Band),
      minCohort,
    )
    return summary ? { available: true, ...summary } : { available: false }
  })
}
