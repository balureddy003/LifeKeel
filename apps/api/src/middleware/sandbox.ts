/**
 * Sandbox Middleware
 * 
 * When sandbox mode is enabled, intercepts API calls and returns
 * simulated data instead of real database queries.
 * 
 * This allows users to explore LifeKeel's full potential before
 * connecting real data sources.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Db } from 'mongodb'
import { getSandboxData } from '../data/sandbox-seed.js'

interface SandboxContext {
  enabled: boolean
  tenant_id: string
  /** Scopes sandbox samples to the tenant's actual active vertical — see getSandboxData()'s filter. */
  active_vertical?: string
}

// Sandbox insight ids (e.g. insight_trading_001) are fabricated samples with
// no row in the real `insights` collection, so POST /insights/:id/approve
// and /dismiss — which look the row up by id before updating it — always
// 404 for them. GET /insights is also fully sandbox-intercepted (see below),
// so a real DB write there wouldn't even be reflected back. This in-memory,
// per-tenant map is the smallest fix that keeps approve/dismiss self-
// consistent within a sandbox session without touching Mongo for data that
// was never real to begin with.
const sandboxInsightOverrides = new Map<string, Map<string, 'completed' | 'dismissed'>>()
function getInsightOverrides(tenantId: string): Map<string, 'completed' | 'dismissed'> {
  let m = sandboxInsightOverrides.get(tenantId)
  if (!m) { m = new Map(); sandboxInsightOverrides.set(tenantId, m) }
  return m
}

/**
 * Check if the request is in sandbox mode
 */
function isSandboxRequest(req: FastifyRequest): boolean {
  const q = req.query as Record<string, unknown>
  // Check query param
  if (q.sandbox === '1' || q.sandbox === 'true') {
    return true
  }

  // Check header
  if (req.headers['x-sandbox-mode'] === 'true') {
    return true
  }

  // Demo-token visitors (GET /auth/demo-token) always get sandbox data —
  // otherwise "Try the demo" drops them into the real, empty acme-corp
  // tenant instead of the populated sample workspace this middleware exists
  // to provide. See auth.demo claim, server.ts's demo-token handler.
  if (req.authContext?.demo === true) {
    return true
  }

  return false
}

/**
 * Get sandbox context from tenant settings
 */
async function getSandboxContext(db: Db, tenantId: string): Promise<SandboxContext> {
  const tenantSettings = db.collection('tenant_settings')
  const settings = await tenantSettings.findOne({ tenant_id: tenantId })
  return {
    enabled: settings?.sandbox_mode ?? false,
    tenant_id: tenantId,
    active_vertical: settings?.active_vertical as string | undefined,
  }
}

/**
 * Middleware to intercept and return sandbox data
 */
export async function sandboxMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Db,
) {
  const tenantId = req.authContext.tenant_id
  
  // Check if sandbox mode is enabled
  const context = await getSandboxContext(db, tenantId)
  if (!context.enabled && !isSandboxRequest(req)) {
    return // Not in sandbox mode, proceed normally
  }
  
  // Intercept specific endpoints
  const url = req.url

  // Goals — order matters: check the most specific path shapes first, since
  // `/goals/:id/progress` and `/goals/:id` both start with `/goals` and would
  // otherwise incorrectly match the plain list handler below (this used to
  // send { goals: [...] } for a progress request, silently breaking Home's
  // `r.progress` read — see A9-adjacent note in AI_DIFFERENTIATION_GAPS.md).
  // Sandbox goals are static flavor samples. A goal created via POST /goals
  // (not intercepted — it hits the real `goals` collection and returns a
  // genuine 201) used to be invisible forever afterward, because every GET
  // below only ever returned the static array, with no memory of real
  // writes. Merging in the tenant's real documents alongside the seed
  // samples keeps the demo flavor while making real creates actually show
  // up — and every other goal sub-route (kpis, autonomy, archive) already
  // operates on these same real documents unintercepted, so this is the
  // only place that needed to change.
  const seedGoals = getSandboxData('goals', context.active_vertical)
  if (url.startsWith('/goals') && req.method === 'GET') {
    const realDocs = await db.collection('goals')
      .find({ tenant_id: tenantId, status: { $ne: 'archived' } })
      .sort({ created_at: -1 })
      .toArray()
    const realGoals = realDocs.map(g => ({
      id: g['id'] as string,
      name: g['name'] as string,
      description: (g['description'] as string) ?? '',
      timeline_days: g['timeline_days'] as number,
      start_date: new Date(g['start_date'] as unknown as string).toISOString(),
      target_date: new Date(g['target_date'] as unknown as string).toISOString(),
      kpis: g['kpis'] as typeof seedGoals[number]['kpis'],
      status: (g['status'] === 'active' || g['status'] === 'achieved' ? g['status'] : 'stalled') as typeof seedGoals[number]['status'],
      detector_ids: (g['detector_ids'] as string[]) ?? [],
      vertical: context.active_vertical ?? 'smb-operations',
    }))
    const goals = [...realGoals, ...seedGoals]

    if (url.match(/^\/goals\/[^/]+\/progress(\?.*)?$/)) {
      const goalId = url.split('/')[2]
      const goal = goals.find(g => g.id === goalId)
      if (!goal) return reply.status(404).send({ error: 'Goal not found' })
      const kpis = goal.kpis.map(k => {
        const pct = k.direction === 'increase'
          ? k.current / k.target
          : k.target > 0 ? 1 - k.current / k.target : 1
        return { ...k, pct_complete: Math.max(0, Math.min(1, pct)) }
      })
      const avgPct = kpis.reduce((sum, k) => sum + k.pct_complete, 0) / (kpis.length || 1)
      const overall_status = avgPct >= 1 ? 'achieved' : avgPct >= 0.5 ? 'ahead' : avgPct >= 0.2 ? 'behind' : 'stalled'
      return reply.send({ progress: { goal, kpis, overall_status } })
    }

    if (url.match(/^\/goals\/[^/]+(\?.*)?$/)) {
      const goalId = url.split('/')[2]
      const goal = goals.find(g => g.id === goalId)
      if (goal) return reply.send({ goal })
      return reply.status(404).send({ error: 'Goal not found' })
    }

    return reply.send({ goals })
  }

  // Insight approve/dismiss — sandbox insight ids (insight_trading_001, etc.)
  // have no row in the real `insights` collection, so the real routes' own
  // findOneAndUpdate-by-id 404s every time. Since GET /insights below is
  // fully sandbox-intercepted anyway (a real DB write here wouldn't even be
  // read back), record the action in-memory instead and apply it to every
  // subsequent read — the smallest fix that makes Approve/Dismiss actually
  // stick within a sandbox session instead of silently 404ing.
  const insightActionMatch = url.match(/^\/insights\/([^/]+)\/(approve|dismiss)(\?.*)?$/)
  if (insightActionMatch && req.method === 'POST') {
    const [, insightId, action] = insightActionMatch as [string, string, 'approve' | 'dismiss']
    const insights = getSandboxData('insights', context.active_vertical)
    if (!insights.some(i => i.id === insightId)) {
      return reply.status(404).send({ error: 'Insight not found or already actioned' })
    }
    getInsightOverrides(tenantId).set(insightId, action === 'approve' ? 'completed' : 'dismissed')
    return reply.send({ ok: true, id: insightId, state: action === 'approve' ? 'completed' : 'dismissed' })
  }

  // GET /insights/:id/action-preview — the approval-gate read the real
  // route serves (routes/insights.ts). Sandbox insights have no real
  // insights-collection row, so without this branch the generic /insights
  // GET intercept below would answer with a list-shaped response the gate
  // screen can't render. Classifies with the same previewActions the real
  // route uses, so the demo gate describes the same effects a real approve
  // would.
  const actionPreviewMatch = url.match(/^\/insights\/([^/]+)\/action-preview(\?.*)?$/)
  if (actionPreviewMatch && req.method === 'GET') {
    const insightId = actionPreviewMatch[1]
    const insights = getSandboxData('insights', context.active_vertical)
    const insight = insights.find(i => i.id === insightId)
    if (!insight) return reply.status(404).send({ error: 'Insight not found' })
    const { previewActions } = await import('../actions/action-executor.js')
    return reply.send({
      insight,
      actions: previewActions((insight as { actions?: string[] }).actions ?? []),
      dry_run: false,
    })
  }

  // Insights — respect ?state= the same way the real /insights route does,
  // so a caller asking for 'identified' (Home, Positions) doesn't silently
  // get dismissed/completed sample rows mixed in ahead of the live ones.
  // Also mirrors exclude_category/exclude_detector_id + `total` from the
  // real route (apps/api/src/routes/insights.ts) — Home's decisions-waiting
  // count reads `total` directly, and without it here every sandbox/demo
  // tenant would silently show 0 regardless of how many opportunities are
  // actually in the Pulse feed below it.
  if (url.startsWith('/insights') && req.method === 'GET') {
    const overrides = getInsightOverrides(tenantId)
    let insights = getSandboxData('insights', context.active_vertical)
      .map(i => (overrides.has(i.id) ? { ...i, state: overrides.get(i.id)! } : i))
    const stateParam = (req.query as Record<string, unknown>)?.['state']
    if (typeof stateParam === 'string') {
      insights = insights.filter(i => i.state === stateParam)
    }
    const excludeCategoryParam = (req.query as Record<string, unknown>)?.['exclude_category']
    if (typeof excludeCategoryParam === 'string') {
      const excluded = excludeCategoryParam.split(',')
      insights = insights.filter(i => !excluded.includes(i.category))
    }
    const excludeDetectorIdParam = (req.query as Record<string, unknown>)?.['exclude_detector_id']
    if (typeof excludeDetectorIdParam === 'string') {
      const excluded = excludeDetectorIdParam.split(',')
      insights = insights.filter(i => !excluded.includes(i.detector_id))
    }
    const total = insights.length
    const limitParam = Number((req.query as Record<string, unknown>)?.['limit'])
    if (Number.isFinite(limitParam) && limitParam > 0) {
      insights = insights.slice(0, limitParam)
    }
    return reply.send({ insights, total })
  }
  
  // Workflows — single-item detail. SandboxWorkflow (id/name/runs_count/
  // attribution) is only a lightweight stats summary, not a full trigger/
  // nodes/edges graph — synthesizing a WorkflowDef straight from it used to
  // omit `trigger` entirely, which crashed workflowToYaml() on
  // `wf.trigger.detector`. Sandbox workflow ids (e.g. workflow_trading_
  // concentration_review) are fictional demo ids with no backing YAML
  // definition in the real WorkflowLoader, so a bare pass-through 404s for
  // every playbook in the demo catalogue — the fix is to build a minimal,
  // honest single-node WorkflowDef from the same description already shown
  // in the list, rather than inventing a multi-step graph that never ran.
  // '/workflows/runs' is a reserved sub-route (run history), not a workflow
  // id, so it's excluded and falls through (sandbox has no seeded run data).
  const workflowDetailMatch = url.match(/^\/workflows\/([^/?]+)(\?.*)?$/)
  if (workflowDetailMatch && workflowDetailMatch[1] !== 'runs' && req.method === 'GET') {
    const workflows = getSandboxData('workflows', context.active_vertical)
    const sw = workflows.find(w => w.id === workflowDetailMatch[1])
    if (sw) {
      return reply.send({
        workflow: {
          id: sw.id,
          name: sw.name,
          version: '1.0.0',
          enabled: true,
          trigger: { condition: sw.description },
          state: {},
          nodes: [
            { id: 'demo_summary', type: 'notify', label: sw.name, config: { channel: 'in_app', template: sw.description } },
          ],
          edges: [],
        },
      })
    }
    // Not a seeded sandbox workflow — fall through to the real loader in
    // case a genuine YAML-defined workflow id was requested.
  }

  if ((url === '/workflows' || url.startsWith('/workflows?')) && req.method === 'GET') {
    const workflows = getSandboxData('workflows', context.active_vertical)
    // The real list route (routes/workflows.ts) always adds `version` and
    // `node_count` on top of the loader's definitions; SandboxWorkflow never
    // had them (it's just id/name/description/runs_count/attribution), so
    // every demo playbook card rendered a bare "nodes" and "v" with no
    // number — matches the single synthesized node the detail route below
    // builds for these same fictional ids.
    const withMeta = workflows.map(w => ({ ...w, version: '1.0.0', node_count: 1 }))
    return reply.send({ workflows: withMeta })
  }

  // Attribution
  // Frontend's AttributionPage reads `summary.workflows` directly (typed as
  // WorkflowAttribution[]) and crashes with "Cannot read properties of
  // undefined (reading 'map')" if it's missing — this used to return the raw
  // SandboxWorkflow[] shape (id/name/description/runs_count/attribution/
  // vertical) as a top-level sibling key instead of nesting the mapped
  // WorkflowAttribution[] inside `summary`, and omitted summary's other
  // required fields (converted/dismissed/expired/pending/conversion_rate/
  // avg_value_per_conversion_minor_units/period_days) entirely.
  if (url.startsWith('/attribution') && req.method === 'GET') {
    const sandboxWorkflows = getSandboxData('workflows', context.active_vertical)
    const workflowAttributions = sandboxWorkflows.map(w => ({
      workflow_id: w.id,
      workflow_name: w.name,
      total_runs: w.runs_count,
      converted: Math.round(w.runs_count * w.attribution.conversion_rate),
      dismissed: 0,
      total_value_minor_units: w.attribution.total_value_minor_units,
      conversion_rate: w.attribution.conversion_rate,
    }))
    const totalValue = workflowAttributions.reduce((sum, w) => sum + w.total_value_minor_units, 0)
    const totalRuns = workflowAttributions.reduce((sum, w) => sum + w.total_runs, 0)
    const totalConverted = workflowAttributions.reduce((sum, w) => sum + w.converted, 0)
    const topWorkflow = [...workflowAttributions].sort((a, b) => b.total_value_minor_units - a.total_value_minor_units)[0]
    return reply.send({
      summary: {
        period_days: 30,
        total_runs: totalRuns,
        converted: totalConverted,
        dismissed: 0,
        expired: 0,
        pending: 0,
        conversion_rate: totalRuns > 0 ? totalConverted / totalRuns : 0,
        total_value_minor_units: totalValue,
        currency: 'GBP',
        avg_value_per_conversion_minor_units: totalConverted > 0 ? Math.round(totalValue / totalConverted) : 0,
        workflows: workflowAttributions,
        narrative: {
          // totalValue is minor units (pence); /100 → pounds, /1000 again → £k.
          // The old version divided by 100 only, then appended 'k' anyway —
          // reporting "£9200.0k" (£9.2m) for what was actually £9.2k.
          headline: `£${(totalValue / 100_000).toFixed(1)}k recovered in 30 days`,
          // Was a hardcoded "Invoice recovery workflow" claim regardless of
          // which workflow actually drove the numbers above it.
          subtext: topWorkflow
            ? `${topWorkflow.workflow_name} performed ${(topWorkflow.conversion_rate * 100).toFixed(0)}% conversion rate`
            : 'Connect more workflows to see performance comparisons',
          period: '30 days',
          confidence: 'high',
        },
      },
      workflows: workflowAttributions,
      currency: 'GBP',
    })
  }
  
  // Verified Moments
  if (url.startsWith('/verified-moments') && req.method === 'GET') {
    const moments = getSandboxData('verified_moments', context.active_vertical)
    return reply.send({ verified_moments: moments })
  }

  // Analytics: trust-metrics — checked before the generic /analytics handler
  // below (same too-broad-startsWith trap fixed for /goals above). Computed
  // for real from the sandbox insights rather than hardcoded, so it's an
  // honest reflection of the sample data instead of another fabricated number.
  if (url.match(/^\/analytics\/trust-metrics(\?.*)?$/) && req.method === 'GET') {
    const insights = getSandboxData('insights', context.active_vertical)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recent = insights.filter(i => new Date(i.created_at).getTime() >= thirtyDaysAgo)

    const byDetector = new Map<string, typeof recent>()
    for (const insight of recent) {
      const list = byDetector.get(insight.detector_id) ?? []
      list.push(insight)
      byDetector.set(insight.detector_id, list)
    }

    const detectors = Array.from(byDetector.entries()).map(([detectorId, stats]) => {
      const total = stats.length
      const approved = stats.filter(i => i.state === 'completed').length
      const dismissed = stats.filter(i => i.state === 'dismissed').length
      const pending = stats.filter(i => i.state === 'identified').length
      const accuracyRate = total > 0 ? approved / total : 0
      const avgConfidence = total > 0
        ? stats.reduce((sum, i) => sum + i.confidence_breakdown.combined_score, 0) / total
        : 0
      return {
        detector_id: detectorId,
        insights_30d: total,
        approved_30d: approved,
        dismissed_30d: dismissed,
        pending_30d: pending,
        accuracy_rate: Math.round(accuracyRate * 100) / 100,
        dismiss_rate: total > 0 ? Math.round((dismissed / total) * 100) / 100 : 0,
        avg_confidence: Math.round(avgConfidence * 100) / 100,
        calibration_ece: null,
        calibration_temperature: null,
        calibration_samples: 0,
        calibration_active: 'none',
        calibration_fitted_at: null,
        total_all_time: total,
        approved_all_time: approved,
        trust_label: total < 5 ? 'New — gathering data' : accuracyRate >= 0.8 ? 'Highly reliable' : 'Building track record',
      }
    })

    const totalInsights = detectors.reduce((sum, d) => sum + d.insights_30d, 0)
    const totalApproved = detectors.reduce((sum, d) => sum + d.approved_30d, 0)
    const totalDismissed = detectors.reduce((sum, d) => sum + d.dismissed_30d, 0)

    return reply.send({
      summary: {
        total_insights_30d: totalInsights,
        total_approved_30d: totalApproved,
        total_dismissed_30d: totalDismissed,
        approval_rate: totalInsights > 0 ? Math.round((totalApproved / totalInsights) * 100) / 100 : 0,
        avg_calibration_ece: null,
        avoided_loss_minor: 0,
      },
      detectors,
    })
  }

  // Analytics
  if (url.startsWith('/analytics') && req.method === 'GET') {
    return reply.send({
      convergence_score: {
        score: 78,
        components: {
          approval_rate: 25,
          calibration_accuracy: 22,
          f1_trend: 18,
          cost_efficiency: 13,
        },
        trend: 'up',
        interpretation: 'Your system is improving quickly',
      },
    })
  }
  
  // For other endpoints, proceed normally
  // (The sandbox mode flag will be passed to downstream handlers)
}

/**
 * Second interception point for sandbox requests that need the parsed
 * request body — must run as a `preHandler` hook, not `onRequest` (where
 * sandboxMiddleware above runs): Fastify hasn't parsed the body yet at
 * `onRequest` time, so `req.body` reads as undefined there regardless of
 * what the client actually sent. PUT /auth/profile is the only sandbox
 * write that needs to read the body — insight approve/dismiss and goal
 * creation only need the URL, so they stay in sandboxMiddleware.
 */
export async function sandboxWriteMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Db,
) {
  const tenantId = req.authContext.tenant_id
  const context = await getSandboxContext(db, tenantId)
  if (!context.enabled && !isSandboxRequest(req)) return

  // Profile save — demo/sandbox sessions (e.g. the "Try the demo" token)
  // carry a user_id/tenant_id that was never provisioned as a real `users`
  // document, so the real PUT /auth/profile 404s on its own
  // findOne-before-update guard ("User not found"), while the studio page
  // applies an optimistic local update regardless — it looks saved but
  // never was. GET /auth/me already degrades gracefully when no user
  // document exists, so upserting one here (instead of requiring it to
  // pre-exist) is enough to make both the save and the following reload
  // consistent, without needing a parallel in-memory profile store.
  if (req.url === '/auth/profile' && req.method === 'PUT') {
    const body = (req.body ?? {}) as { name?: string; email?: string; avatar_color?: string }
    const update: Record<string, unknown> = {}
    if (body.name) update['name'] = body.name.trim()
    if (body.avatar_color) update['avatar_color'] = body.avatar_color
    if (body.email) update['email'] = body.email.toLowerCase()
    if (Object.keys(update).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' })
    }
    const usersCol = db.collection('users')
    await usersCol.updateOne(
      { id: req.authContext.user_id, tenant_id: tenantId },
      {
        $set: update,
        $setOnInsert: { id: req.authContext.user_id, tenant_id: tenantId, email_verified: true, created_at: new Date() },
      },
      { upsert: true },
    )
    const updated = await usersCol.findOne({ id: req.authContext.user_id, tenant_id: tenantId })
    return reply.send({
      user: {
        id: updated!['id'],
        email: updated!['email'],
        name: updated!['name'],
        tenant_id: updated!['tenant_id'],
        avatar_color: updated!['avatar_color'],
      },
    })
  }

  return undefined
}

/**
 * Hook to add sandbox mode to request context
 */
export async function addSandboxContext(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Db,
) {
  const tenantId = req.authContext.tenant_id
  const context = await getSandboxContext(db, tenantId)
  
  // Add to request context for downstream handlers
  ;(req as any).sandboxContext = context
  
  // Add response header to indicate sandbox mode
  if (context.enabled || isSandboxRequest(req)) {
    reply.header('X-Sandbox-Mode', 'true')
  }
}
