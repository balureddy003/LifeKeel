/**
 * POST /readiness-quiz — public, unauthenticated "Family Readiness Score"
 * (PRD-201, the marketing-PRD sequence's first entry).
 *
 * Cold visitors get a real number produced by the exact same
 * `@agentoak/engine` detector rules a logged-in family's data runs
 * through (family_protection_gap, family_emergency_fund_adequacy) — not a
 * simplified marketing-only approximation. Deliberately Tier 0: nothing
 * about the visitor is persisted against an identifier. Unlike
 * /family/financial-profile (the authenticated route this mirrors), this
 * route never calls persistSignal — there is no tenant to persist a
 * signal against, and the whole point of a lead-magnet quiz is that
 * answering it creates no record tied to the visitor. Only an anonymized
 * score-band is logged, via the same growth_events collection the
 * landing page's funnel events already use.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine } from '@agentoak/engine'
import { getGrowthEventsCollection } from '../db.js'

const QuizSchema = z.object({
  monthly_salary_minor: z.number().int().nonnegative(),
  emergency_savings_minor: z.number().int().nonnegative(),
  monthly_expenses_minor: z.number().int().nonnegative(),
  mortgage_outstanding_minor: z.number().int().nonnegative(),
  life_cover_minor: z.number().int().nonnegative(),
  dependents: z.number().int().nonnegative(),
})

type QuizAnswers = z.infer<typeof QuizSchema>

interface EngineInsight {
  hypothesis: string
  reasoning: string
  category: string
  rule_id: string
  estimated_impact_low: number
  estimated_impact_high: number
  confidence_breakdown?: { combined_score?: number; or_score?: number }
}

function confidenceOf(insight: EngineInsight): number {
  return insight.confidence_breakdown?.combined_score ?? insight.confidence_breakdown?.or_score ?? 0
}

function scoreBand(score: number): string {
  const lower = Math.floor(score / 10) * 10
  return `${lower}-${lower + 10}`
}

export async function registerReadinessQuizRoutes(app: FastifyInstance, db: Db, engine: Engine): Promise<void> {
  app.post<{ Body: QuizAnswers }>('/readiness-quiz', async (req, reply) => {
    const parsed = QuizSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid quiz answers', issues: parsed.error.issues })
    }
    const answers = parsed.data

    try {
      // A synthetic, per-request, never-logged tenant_id — required by
      // Engine.evaluate()'s signature but not used for correlation by
      // either detector below (neither declares `correlation:`).
      const anonTenantId = crypto.randomUUID()

      const protectionResult = await engine.evaluate({
        event_type: 'family.household',
        tenant_id: anonTenantId,
        event_id: crypto.randomUUID(),
        data: {
          employed: 1,
          years_to_retirement: 40,
          monthly_salary_minor: answers.monthly_salary_minor,
          annual_living_expenses_minor: answers.monthly_expenses_minor * 12,
          mortgage_outstanding_minor: answers.mortgage_outstanding_minor,
          life_cover_minor: answers.life_cover_minor,
          income_protection_monthly_minor: 0,
          education_funding_gap_minor: 0,
          has_dependents: Number(answers.dependents > 0),
          has_health_or_ci_cover: 0,
          soonest_renewal_days: 9999,
          soonest_renewal_provider: '',
          soonest_renewal_type: '',
        },
        derived_from_signals: [],
      })

      const emergencyFundResult = await engine.evaluate({
        event_type: 'family.savings',
        tenant_id: anonTenantId,
        event_id: crypto.randomUUID(),
        data: {
          emergency_savings_minor: answers.emergency_savings_minor,
          monthly_expenses_minor: answers.monthly_expenses_minor,
          has_high_interest_debt: 0,
          high_interest_debt_balance_minor: 0,
        },
        derived_from_signals: [],
      })

      const insights = [...protectionResult.insights, ...emergencyFundResult.insights] as unknown as EngineInsight[]
      const openPenalty = insights.reduce((sum, i) => sum + confidenceOf(i), 0)
      const score = Math.round(Math.max(0, Math.min(100, 100 - openPenalty * 10)))

      const topInsights = [...insights]
        .sort((a, b) => confidenceOf(b) - confidenceOf(a))
        .slice(0, 2)
        .map((i) => ({
          hypothesis: i.hypothesis,
          reasoning: i.reasoning,
          category: i.category,
          rule_id: i.rule_id,
          estimated_impact_low: i.estimated_impact_low,
          estimated_impact_high: i.estimated_impact_high,
        }))

      // Anonymized funnel event — no identifier of any kind, only the
      // score band (e.g. "60-70") for conversion analysis. A logging
      // failure must never surface as a broken quiz result.
      await getGrowthEventsCollection(db)
        .insertOne({ event: 'readiness_quiz_completed', meta: { score_band: scoreBand(score) }, created_at: new Date() })
        .catch(() => {})

      return reply.send({ score, insights: topInsights })
    } catch (err) {
      req.log.warn({ err }, 'Readiness quiz evaluation failed')
      return reply.send({ score: null, insights: [], error: "Couldn't calculate your score right now — please try again later." })
    }
  })
}
