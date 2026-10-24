/**
 * Attribution journeys — who came from where, and how far they got.
 *
 * Identity-resolved, and deliberately only as far as consent allows:
 *   - a signup's first touch is its own stored attribution; if that is empty,
 *     the attribution on the consented lead record with the same email;
 *   - last touch is the UTM/referrer seen most recently before signup
 *     (`users.last_touch`), falling back to first touch when not captured;
 *   - there is NO join from an anonymous visitor id (`anon_id`) to a person —
 *     that would profile people who never consented to be identified.
 *
 * Journeys stay server-side. Everything that leaves this module is a count by
 * source / campaign / content item (see journeyRows), never a person.
 * Minors, deleted or suspended accounts and unverified signups are excluded.
 */
import type { Db } from 'mongodb'
import { excludeMinorUsers } from '../family/family-permissions.js'
import { attributionContent, attributionKey } from './utm.js'

export type AttributionModel = 'first' | 'last'
export const ATTRIBUTION_MODELS: readonly AttributionModel[] = ['first', 'last']

export interface Touch {
  source: string
  campaign: string
  content: string
}

export interface Journey {
  tenant_id: string
  signed_up_at: Date
  first: Touch
  last: Touch
  /** False when no last touch was captured and it falls back to first touch. */
  last_touch_known: boolean
  /** First touch came from the consented lead record, not the signup. */
  first_from_lead: boolean
  referred: boolean
  profile: boolean
  /** The activation step: the family has received a first insight. */
  first_insight: boolean
  paid_at: Date | null
  revenue_pence: number
}

const touchOf = (a: Record<string, unknown> | null | undefined): Touch => ({
  ...attributionKey(a),
  content: attributionContent(a),
})

const hasSignal = (a: Record<string, unknown> | null | undefined): boolean =>
  !!a && Object.keys(a).some((k) => k.startsWith('utm_') || k === 'referrer')

export async function buildJourneys(db: Db, range: { $gte: Date; $lte: Date }): Promise<Journey[]> {
  const rawUsers = await db
    .collection('users')
    .find(
      {
        created_at: range,
        status: 'active',
        registration_status: { $ne: 'pending' },
      },
      {
        projection: {
          _id: 0,
          id: 1,
          email: 1,
          tenant_id: 1,
          created_at: 1,
          attribution: 1,
          last_touch: 1,
        },
      },
    )
    .sort({ created_at: 1 })
    .toArray()
  const users = await excludeMinorUsers(db, rawUsers)
  if (users.length === 0) return []

  // A family counts once, under its first signup.
  const seen = new Set<string>()
  const firstUsers = users.filter((u) => {
    const t = u['tenant_id'] as string
    if (!t || seen.has(t)) return false
    seen.add(t)
    return true
  })
  const tenantIds = firstUsers.map((u) => u['tenant_id'] as string)
  const emails = firstUsers.map((u) => String(u['email'] ?? '').toLowerCase()).filter(Boolean)

  const [leads, profileTenants, insightTenants, referred, payments] = await Promise.all([
    db
      .collection('leads')
      .find(
        { email: { $in: emails }, 'consent.marketing': true, suppressed: { $ne: true } },
        { projection: { _id: 0, email: 1, attribution: 1 } },
      )
      .toArray(),
    db
      .collection('family_financial_profile')
      .distinct('tenant_id', { tenant_id: { $in: tenantIds } }),
    db.collection('insights').distinct('tenant_id', { tenant_id: { $in: tenantIds } }),
    db
      .collection('referrals')
      .distinct('referred_tenant_id', { referred_tenant_id: { $in: tenantIds } }),
    db
      .collection('revenue_events')
      .aggregate<{ _id: string; first: Date; net: number }>([
        { $match: { tenant_id: { $in: tenantIds }, currency: 'gbp', net_pence: { $gt: 0 } } },
        { $group: { _id: '$tenant_id', first: { $min: '$paid_at' }, net: { $sum: '$net_pence' } } },
      ])
      .toArray(),
  ])
  const leadAttr = new Map(
    leads.map((l) => [
      String(l['email']).toLowerCase(),
      l['attribution'] as Record<string, unknown> | undefined,
    ]),
  )
  const hasProfile = new Set(profileTenants.map(String))
  const hasInsight = new Set(insightTenants.map(String))
  const isReferred = new Set(referred.map(String))
  const paid = new Map(payments.map((p) => [String(p._id), p]))

  return firstUsers.map((u) => {
    const tenant = u['tenant_id'] as string
    const own = u['attribution'] as Record<string, unknown> | undefined
    const fromLead = leadAttr.get(String(u['email'] ?? '').toLowerCase())
    const useLead = !hasSignal(own) && hasSignal(fromLead)
    const firstAttr = useLead ? fromLead : own
    const lastAttr = u['last_touch'] as Record<string, unknown> | undefined
    const lastKnown = hasSignal(lastAttr)
    const pay = paid.get(tenant)
    return {
      tenant_id: tenant,
      signed_up_at: u['created_at'] as Date,
      first: touchOf(firstAttr),
      last: touchOf(lastKnown ? lastAttr : firstAttr),
      last_touch_known: lastKnown,
      first_from_lead: useLead,
      referred: isReferred.has(tenant),
      profile: hasProfile.has(tenant),
      first_insight: hasInsight.has(tenant),
      paid_at: pay?.first ?? null,
      revenue_pence: pay?.net ?? 0,
    }
  })
}

export const JOURNEY_STEPS = ['signup', 'profile', 'first_insight', 'paid', 'revenue'] as const
export type JourneyStep = (typeof JOURNEY_STEPS)[number]

export const journeyDim = (
  model: AttributionModel,
  step: JourneyStep,
  t: Pick<Touch, 'source' | 'campaign' | 'content'>,
) => `${model}|${step}|${t.source}|${t.campaign}|${t.content}`

export function parseJourneyDim(
  dim: string,
): {
  model: AttributionModel
  step: JourneyStep
  source: string
  campaign: string
  content: string
} | null {
  const [model, step, source, campaign, content] = dim.split('|')
  if (
    !model ||
    !step ||
    !source ||
    !campaign ||
    !content ||
    !(ATTRIBUTION_MODELS as readonly string[]).includes(model) ||
    !(JOURNEY_STEPS as readonly string[]).includes(step)
  )
    return null
  return { model: model as AttributionModel, step: step as JourneyStep, source, campaign, content }
}

export interface JourneyRow {
  day: string
  metric: 'journey'
  dim: string
  count: number
}

/** Collapse journeys to counts by model, step and touch. `revenue` counts pence. */
export function journeyRows(journeys: Journey[], day: string): JourneyRow[] {
  const sums = new Map<string, number>()
  const add = (dim: string, n: number) => sums.set(dim, (sums.get(dim) ?? 0) + n)
  for (const j of journeys) {
    for (const model of ATTRIBUTION_MODELS) {
      const t = model === 'first' ? j.first : j.last
      add(journeyDim(model, 'signup', t), 1)
      if (j.profile) add(journeyDim(model, 'profile', t), 1)
      if (j.first_insight) add(journeyDim(model, 'first_insight', t), 1)
      if (j.paid_at) add(journeyDim(model, 'paid', t), 1)
      if (j.revenue_pence > 0) add(journeyDim(model, 'revenue', t), j.revenue_pence)
    }
  }
  return [...sums].map(([dim, count]) => ({ day, metric: 'journey' as const, dim, count }))
}

/** The cohort that signed up on `day`, as rollup rows. */
export async function cohortJourneyRows(
  db: Db,
  day: string,
  range: { $gte: Date; $lte: Date },
): Promise<JourneyRow[]> {
  return journeyRows(await buildJourneys(db, range), day)
}
