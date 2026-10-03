/**
 * GET /family/readiness — the composite Family Readiness Score (PRD-114).
 *
 * Server-side, deterministic subscores (readiness/score.ts) computed fresh
 * from the current financial profile + vault contents on every read — the
 * same "numbers stay live, never frozen at write time" posture as
 * render-playbook.ts. This replaces the client-derived
 * 100 − Σ confidence×10 math apps/web used before, which could not see
 * estate readiness and could not tell "evaluated and clear" apart from
 * "never evaluated" without a second fetch.
 *
 * Explaining insights ride along per component so the UI can show *why* a
 * subscore dropped — the score is computed from profile inputs, not from
 * insight counts, so the two never disagree by construction.
 *
 * Access: any authenticated member of the tenant. The estate component is
 * gated to adults (vault contents are adult-only — see vault.ts); a
 * child's call returns the same response with the estate component marked
 * gated and excluded from the composite.
 *
 * Tier 0 — pure read, no side effects.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@agentoak/platform'
import { isFamilyAdult } from '../lib/family-permissions.js'
import { ESTATE_VAULT_CATEGORY } from './documents.js'
import { computeReadiness, type ReadinessComponentKey } from '../readiness/score.js'
import { FinancialProfileSchema, type FinancialProfile } from './family-financial-profile.js'

const HISTORY_COLLECTION = 'family_readiness_history'
const HISTORY_LIMIT = 90

const FAMILY_DETECTORS = new Set([
  'family_protection_gap',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
  'family_education_shortfall',
  'family_estate_readiness',
  'family_education_pacing',
  'family_emergency_trajectory',
  'family_debt_health',
  'family_policy_review',
])

// Which composite component a family detector explains.
const DETECTOR_TO_COMPONENT: Record<string, ReadinessComponentKey> = {
  family_emergency_fund_adequacy: 'emergency_fund',
  family_protection_gap: 'protection',
  family_retirement_gap: 'retirement',
  family_education_shortfall: 'education',
  family_estate_readiness: 'estate',
  family_education_pacing: 'education',
  // Debt burden and fund-building pace both bear on liquidity — closest
  // composite component is the emergency fund.
  family_emergency_trajectory: 'emergency_fund',
  family_debt_health: 'emergency_fund',
  family_policy_review: 'protection',
}

// The insight states that count as still-open problems — mirrors
// RESOLVED_INSIGHT_STATES in apps/web/src/lib/api.ts. Keep in sync: an
// approved/dismissed/resolved insight no longer drags the score's
// explanation list.
const OPEN_INSIGHT_STATES = ['identified', 'sent', 'execution_failed', 'snoozed'] as const

interface ExplainingInsight {
  id: string
  detector_id: string
  rule_id: string
  hypothesis: string
  confidence: number
}

export function registerFamilyReadinessRoutes(app: FastifyInstance, db: Db): void {
  app.get('/family/readiness', async (req) => {
    const { tenant_id, user_id } = req.authContext

    const profileDoc = await getTenantCollection<FinancialProfile & { insights_evaluated_at?: Date }>(
      db,
      'family_financial_profile',
      tenant_id,
    ).findOne({})

    const isAdult = await isFamilyAdult(db, tenant_id, user_id)
    const estateDocTypes = isAdult
      ? (
          (await db
            .collection('documents')
            .find(
              { tenant_id, category: ESTATE_VAULT_CATEGORY },
              { projection: { _id: 0, doc_type: 1 } },
            )
            .toArray()) as { doc_type?: string }[]
        ).map((d) => d.doc_type).filter((t): t is string => typeof t === 'string')
      : null

    const openInsights = (await db
      .collection('insights')
      .find(
        { tenant_id, detector_id: { $in: [...FAMILY_DETECTORS] }, state: { $in: [...OPEN_INSIGHT_STATES] } },
        { projection: { _id: 0, id: 1, detector_id: 1, rule_id: 1, hypothesis: 1, confidence: 1 } },
      )
      .toArray()) as unknown as ExplainingInsight[]

    if (!profileDoc) {
      return {
        score: null,
        has_live_data: false,
        computed_at: new Date().toISOString(),
        components: [],
        insights: [],
      }
    }

    const { insights_evaluated_at, ...profileFields } = profileDoc
    const parsed = FinancialProfileSchema.safeParse(profileFields)
    const result = parsed.success
      ? computeReadiness(parsed.data, estateDocTypes)
      : { score: null, components: [] }

    const components = result.components.map((c) => ({
      ...c,
      insights: openInsights
        .filter((i) => DETECTOR_TO_COMPONENT[i.detector_id] === c.key)
        .map((i) => ({ id: i.id, rule_id: i.rule_id, hypothesis: i.hypothesis, confidence: i.confidence })),
    }))

    // Snapshot the score for trend history — one per day max (upsert on
    // the date boundary), only when the score is real. This creates the
    // "how has your readiness changed" data the dashboard sparkline needs
    // without a separate cron or write path.
    if (result.score !== null && insights_evaluated_at) {
      const today = new Date().toISOString().slice(0, 10)
      // Deferred via .then so a synchronous driver error (missing method
      // on a partial db, closed client) lands in the catch too — history
      // is best-effort, it must never block or break the read.
      void Promise.resolve()
        .then(() =>
          db.collection(HISTORY_COLLECTION).updateOne(
            { tenant_id, date: today },
            {
              $set: {
                tenant_id,
                date: today,
                score: result.score,
                components: Object.fromEntries(
                  result.components
                    .filter((c) => c.score !== null && !c.gated)
                    .map((c) => [c.key, c.score]),
                ),
                computed_at: new Date(),
              },
            },
            { upsert: true },
          ),
        )
        .catch(() => {})
    }

    return {
      score: result.score,
      // A profile saved by wizard autosave but never evaluated doesn't
      // count as live — same honesty rule as the client's old
      // insights_evaluated_at check.
      has_live_data: Boolean(insights_evaluated_at),
      computed_at: new Date().toISOString(),
      components,
      insights: openInsights,
    }
  })

  /** GET /family/readiness/history — score snapshots for the trend sparkline. */
  app.get('/family/readiness/history', async (req) => {
    const { tenant_id } = req.authContext
    const snapshots = await db
      .collection(HISTORY_COLLECTION)
      .find({ tenant_id }, { projection: { _id: 0, date: 1, score: 1, components: 1, computed_at: 1 } })
      .sort({ date: -1 })
      .limit(HISTORY_LIMIT)
      .toArray()
    return { history: snapshots.reverse() } // oldest → newest for charting
  })
}
