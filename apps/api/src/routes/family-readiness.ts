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

const FAMILY_DETECTORS = new Set([
  'family_protection_gap',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
  'family_education_shortfall',
  'family_estate_readiness',
])

// Which composite component a family detector explains.
const DETECTOR_TO_COMPONENT: Record<string, ReadinessComponentKey> = {
  family_emergency_fund_adequacy: 'emergency_fund',
  family_protection_gap: 'protection',
  family_retirement_gap: 'retirement',
  family_education_shortfall: 'education',
  family_estate_readiness: 'estate',
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
}
