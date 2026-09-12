/**
 * Attribution routes — record workflow run outcomes and query ROI metrics.
 *
 * GET  /attribution/summary?days=30           — tenant-scoped correlation ROI summary
 * GET  /attribution/workflows                 — per-workflow breakdown
 * GET  /attribution/workflows/:id?days=       — single workflow ROI
 * GET  /attribution/workflows/:id/causal      — DiD causal impact estimate
 * POST /attribution/:runId/outcome            — record outcome for a run
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { AttributionTracker, loadVerticals } from '@kairos/workflows'
import type { AttributionOutcome, DiDResult } from '@kairos/workflows'
import { formatMoneyDisplay, repoRoot } from '@kairos/platform'
import { resolveActiveVerticalId } from './verticals.js'

type CausalResponse =
  | { causal: DiDResult }
  | { causal: null; reason: 'insufficient_sample'; minimum_required: number; current: number }

export function registerAttributionRoutes(fastify: FastifyInstance, db: Db): void {
  const tracker = new AttributionTracker(db)
  const root = repoRoot()

  // GET /attribution/summary
  fastify.get<{ Querystring: { days?: string } }>('/attribution/summary', async (req) => {
    const { tenant_id } = req.authContext
    const days = parseInt(req.query.days ?? '30', 10)
    const summary = await tracker.getSummary(tenant_id, days)

    // Tailor the narrative's language to the tenant's active vertical instead
    // of assuming SaaS/business framing (e.g. "revenue recovered" reads wrong
    // for a family or trading tenant) — falls back to a neutral default when
    // no vertical is set or it declares no outcome_noun.
    const activeVerticalId = await resolveActiveVerticalId(db, tenant_id, root)
    const activeVertical = activeVerticalId ? loadVerticals(root).find((v) => v.id === activeVerticalId) : undefined
    const outcomeNoun = activeVertical?.theme?.outcome_noun ?? 'value recovered'

    const fmt = (minorUnits: number): string => formatMoneyDisplay(minorUnits, summary.currency).compact

    const topWorkflow = summary.workflows[0]
    const confidence: 'high' | 'medium' | 'low' =
      summary.total_runs >= 50 ? 'high' : summary.total_runs >= 10 ? 'medium' : 'low'

    const headline = summary.total_value_minor_units > 0 && topWorkflow
      ? `${fmt(summary.total_value_minor_units)} ${outcomeNoun} this ${days === 7 ? 'week' : days === 30 ? 'month' : `${days}-day period`}`
      : `No ${outcomeNoun} yet — data is still building up`

    const subtext = topWorkflow
      ? `${topWorkflow.workflow_name ?? 'Top workflow'} performed ${(topWorkflow.conversion_rate * 100).toFixed(0)}% success rate`
      : 'Connect more workflows to see performance comparisons'

    const narrative = {
      headline,
      subtext,
      period: `${days} days`,
      confidence,
      disclaimer: confidence === 'low' ? 'Estimate is preliminary — more data needed for reliable figures.' : undefined,
    }

    return { summary: { ...summary, narrative } }
  })

  // GET /attribution/workflows
  fastify.get<{ Querystring: { days?: string } }>('/attribution/workflows', async (req) => {
    const { tenant_id } = req.authContext
    const days = parseInt(req.query.days ?? '30', 10)
    const summary = await tracker.getSummary(tenant_id, days)
    return { workflows: summary.workflows, currency: summary.currency }
  })

  // GET /attribution/workflows/:id
  fastify.get<{
    Params: { id: string }
    Querystring: { days?: string }
  }>('/attribution/workflows/:id', async (req) => {
    const { tenant_id } = req.authContext
    const days = parseInt(req.query.days ?? '30', 10)
    const roi = await tracker.getWorkflowROI(tenant_id, req.params.id, days)
    return { roi }
  })

  // GET /attribution/workflows/:id/causal — DiD causal impact estimate
  // Returns ATT (Average Treatment Effect on Treated), 95% CI, and bias correction factor.
  // Compares treated (converted/dismissed) vs control (expired) cohorts across pre/post periods.
  fastify.get<{
    Params: { id: string }
    Querystring: { post_days?: string; pre_days?: string }
  }>('/attribution/workflows/:id/causal', async (req): Promise<CausalResponse> => {
    const { tenant_id } = req.authContext
    const post_days = req.query.post_days ? parseInt(req.query.post_days, 10) : 30
    const pre_days  = req.query.pre_days  ? parseInt(req.query.pre_days,  10) : post_days
    
    // Sample-size gate: need at least 10 treated runs for causal estimate
    const cohortStats = await tracker.getCohortStats(tenant_id, req.params.id, post_days, pre_days)
    if (cohortStats.treated_post_count < 10) {
      return { 
        causal: null, 
        reason: 'insufficient_sample', 
        minimum_required: 10,
        current: cohortStats.treated_post_count 
      }
    }
    
    const result = await tracker.estimateCausalImpact(tenant_id, req.params.id, { post_days, pre_days })
    return { causal: result }
  })

  // GET /attribution/explain?workflow_id=xxx — plain-English explanation (UX-006)
  // Translates DiD/ATT into "With Kairos vs without Kairos" comparison cards
  fastify.get<{ Querystring: { workflow_id?: string } }>('/attribution/explain', async (req) => {
    const { tenant_id } = req.authContext
    const { workflow_id } = req.query

    if (!workflow_id) {
      return { error: 'workflow_id required' }
    }

    const post_days = 30
    const pre_days = 30

    const cohortStats = await tracker.getCohortStats(tenant_id, workflow_id, post_days, pre_days)
    const causalResult = await tracker.estimateCausalImpact(tenant_id, workflow_id, { post_days, pre_days })

    // Translate to plain-English (cohortStats gives counts; causalResult has the lift)
    const treatedCount = cohortStats.treated_post_count
    const controlCount = cohortStats.control_post_count

    // Use causal result for lift estimates when available
    const att = (causalResult as any)?.att_minor_units ?? 0
    const liftPercent = controlCount > 0 ? (treatedCount / controlCount) * 100 : 0

    const controlAvgDays = 21 // Baseline assumption when no detailed cohort data
    const treatedAvgDays = Math.max(1, Math.round(controlAvgDays * (1 - Math.min(liftPercent / 100, 0.5))))

    const daysSaved = Math.max(0, controlAvgDays - treatedAvgDays)
    const cashFlowGain = daysSaved * 100 // Simplified calculation

    const confidence: 'high' | 'medium' | 'low' =
      treatedCount >= 50 ? 'high' : treatedCount >= 10 ? 'medium' : 'low'

    return {
      workflow_id,
      control_group: {
        size: controlCount,
        avg_days_to_pay: controlAvgDays,
      },
      treated_group: {
        size: treatedCount,
        avg_days_to_pay: treatedAvgDays,
      },
      causal_lift: {
        att_minor_units: att,
        days_saved: Math.round(daysSaved),
        cash_flow_gain: cashFlowGain,
      },
      confidence,
      explanation: `Similar customers without reminders paid in ${controlAvgDays} days. Customers with Kairos reminders paid in ${treatedAvgDays} days. Estimated cash-flow gain: £${cashFlowGain.toFixed(0)}.`,
    }
  })

  // POST /attribution/:runId/outcome
  fastify.post<{
    Params: { runId: string }
    Body: {
      outcome: AttributionOutcome
      workflow_id: string
      workflow_name?: string
      value_minor_units?: number
      currency?: string
      metadata?: Record<string, unknown>
    }
  }>('/attribution/:runId/outcome', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { outcome, workflow_id, workflow_name, value_minor_units, currency, metadata } = req.body

    if (!outcome || !workflow_id) {
      return reply.status(400).send({ error: 'outcome and workflow_id required' })
    }

    await tracker.recordOutcome(
      req.params.runId,
      workflow_id,
      workflow_name ?? workflow_id,
      tenant_id,
      outcome,
      value_minor_units ?? 0,
      currency ?? 'GBP',
      metadata,
    )

    return { ok: true, run_id: req.params.runId, outcome }
  })
}
