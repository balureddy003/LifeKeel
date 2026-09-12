/**
 * Delivery Routes — notifications + one-click actions (no login required)
 *
 * PUBLIC (no auth — signed-token protected):
 *   GET  /a/:token                       — one-click approve/dismiss from notification
 *
 * AUTHENTICATED (JWT):
 *   GET    /delivery/preferences           — get tenant delivery preferences
 *   PUT    /delivery/preferences           — set tenant delivery preferences
 *   POST   /delivery/test                  — send a test notification
 *   POST   /delivery/insights/:id/send     — manually send a specific insight
 *   GET    /delivery/receipts              — delivery audit log
 *   POST   /delivery/push/subscribe        — subscribe to browser push notifications
 *   DELETE /delivery/push/subscribe        — unsubscribe from browser push
 *   GET    /delivery/push/vapid-public-key — get VAPID public key for the browser
 *
 * The GET /a/:token endpoint is the heart of "no app, no login": a business
 * owner taps a link in WhatsApp/SMS/Email/Push and the insight is approved
 * or dismissed with no app, no login, no dashboard.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Insight } from '@kairos/engine'
import { DeliveryRouter, type DeliveryPreferences } from '../delivery/delivery-router.js'
import { ActionExecutor } from '../actions/action-executor.js'
import { recordMomentDecision } from '../verified-moments.js'
import { startGoalExperimentsForApproval } from '../outcomes/causal-experiments.js'

export function registerDeliveryRoutes(
  fastify: FastifyInstance,
  db: Db,
  router = new DeliveryRouter(db),
): void {
  const actionExecutor = new ActionExecutor(db)

  fastify.get<{ Params: { token: string } }>('/why/:token', async (req, reply) => {
    const decoded = router.verifyEvidenceToken(req.params.token)
    if (!decoded) {
      return reply.status(400).type('text/html').send(actionResultPage(
        'Link expired or invalid',
        'This evidence link is no longer valid.',
        false,
      ))
    }
    const insight = await db.collection('insights').findOne({
      id: decoded.insight_id,
      tenant_id: decoded.tenant_id,
    })
    if (!insight) {
      return reply.status(404).type('text/html').send(actionResultPage('Move not found', 'This move may have been removed.', false))
    }
    return reply.type('text/html').send(evidencePage(insight as Record<string, unknown>))
  })

  // ── PUBLIC: one-click action from push message ───────────────────────────
  // This route MUST be in the public allowlist in server.ts auth hook.
  fastify.get<{ Params: { token: string } }>('/a/:token', async (req, reply) => {
    const decoded = router.verifyActionToken(req.params.token)
    if (!decoded) {
      return reply.status(400).type('text/html').send(actionResultPage(
        'Link expired or invalid',
        'This action link is no longer valid. Open Kairos to review your insights.',
        false,
      ))
    }

    const { insight_id, tenant_id, action } = decoded
    const newState = action === 'approve' ? 'completed' : 'dismissed'

    // Update the insight state (scoped to the token's tenant — no cross-tenant access)
    const result = await db.collection<Insight>('insights').findOneAndUpdate(
      { id: insight_id, tenant_id },
      {
        $set: {
          state: newState,
          [action === 'approve' ? 'approved_at' : 'dismissed_at']: new Date(),
          action_source: 'push',
        },
      },
      { returnDocument: 'after' },
    )

    if (!result) {
      return reply.status(404).type('text/html').send(actionResultPage(
        'Insight not found',
        'This insight may have been removed.',
        false,
      ))
    }

    // Record the action for attribution
    await db.collection('insight_actions').insertOne({
      insight_id, tenant_id, action, source: 'push', created_at: new Date(),
    })

    let executionFailed = false
    let actionReceiptIds: string[] = []
    if (action === 'approve') {
      const summary = await actionExecutor.execute(result, tenant_id, {
        approvedBy: 'push-token',
      }).catch((err) => {
        fastify.log.error({ err, insight_id }, 'Push action execution failed')
        executionFailed = true
        return null
      })
      if (summary) {
        actionReceiptIds = summary.receipts.map(r => r.id)
        await db.collection('insight_actions').updateOne(
          { insight_id, tenant_id, action, source: 'push' },
          { $set: { execution_summary: summary } },
        )
      }
    }
    await recordMomentDecision(db, {
      tenantId: tenant_id,
      insightId: insight_id,
      decision: action,
      ...(actionReceiptIds.length > 0 ? { actionReceiptIds } : {}),
    })
    if (action === 'approve') {
      await startGoalExperimentsForApproval(db, result, actionReceiptIds)
    }

    const title = action === 'approve' ? '✅ Approved' : 'Dismissed'
    const body = action === 'approve' && executionFailed
      ? 'This opportunity was approved, but action execution failed. Open Kairos to review the receipts.'
      : action === 'approve'
      ? 'This opportunity has been approved. Kairos will execute the recommended action.'
      : 'This insight has been dismissed and will not be shown again.'

    return reply.status(200).type('text/html').send(actionResultPage(title, body, action === 'approve'))
  })

  // ── AUTHENTICATED: get preferences ───────────────────────────────────────
  fastify.get('/delivery/preferences', async (req) => {
    const tenantId = req.authContext.tenant_id
    const prefs = await router.getPreferences(tenantId)
    return prefs ?? {
      tenant_id: tenantId,
      channels: ['email'],
      min_urgency: 'high',
      enabled: false,
    }
  })

  // ── AUTHENTICATED: set preferences ───────────────────────────────────────
  fastify.put<{ Body: Partial<DeliveryPreferences> }>('/delivery/preferences', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const body = req.body

    const prefs: DeliveryPreferences = {
      tenant_id: tenantId,                       // ← always from JWT, never body
      channels: body.channels ?? ['email'],
      min_urgency: body.min_urgency ?? 'high',
      enabled: body.enabled ?? true,
      ...(body.whatsapp_to ? { whatsapp_to: body.whatsapp_to } : {}),
      ...(body.sms_to ? { sms_to: body.sms_to } : {}),
      ...(body.email_to ? { email_to: body.email_to } : {}),
      ...(body.business_name ? { business_name: body.business_name } : {}),
      ...(body.quiet_hours_start !== undefined ? { quiet_hours_start: body.quiet_hours_start } : {}),
      ...(body.quiet_hours_end !== undefined ? { quiet_hours_end: body.quiet_hours_end } : {}),
      ...(body.digest_mode !== undefined ? { digest_mode: body.digest_mode } : {}),
    }

    await router.savePreferences(prefs)
    return reply.status(200).send({ ok: true, preferences: prefs })
  })

  // ── AUTHENTICATED: send a test notification ──────────────────────────────
  fastify.post('/delivery/test', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const testInsight = {
      id: `test_${Date.now()}`,
      hypothesis: 'test_notification',
      urgency: 'high',
      confidence_breakdown: { or_score: 0.92 },
      estimated_impact: { low: 160000, high: 290000 },
      currency: 'GBP',
      reasoning: 'This is a test notification from Kairos. Your delivery channel is working correctly.',
      recommended_actions: ['No action needed — this is a test'],
    }
    const result = await router.deliver(testInsight, tenantId)
    if (!result) {
      return reply.status(400).send({ error: 'No delivery preferences configured or channel unavailable' })
    }
    return reply.status(result.success ? 200 : 502).send({ result })
  })

  // ── AUTHENTICATED: manually push a specific insight ──────────────────────
  fastify.post<{ Params: { id: string } }>('/delivery/insights/:id/send', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const insight = await db.collection('insights').findOne({ id: req.params.id, tenant_id: tenantId })
    if (!insight) return reply.status(404).send({ error: 'Insight not found' })
    const result = await router.deliver(insight, tenantId)
    if (!result) return reply.status(400).send({ error: 'Delivery skipped (preferences, urgency floor, or quiet hours)' })
    return reply.status(result.success ? 200 : 502).send({ result })
  })

  // ── AUTHENTICATED: delivery receipts (audit) ─────────────────────────────
  fastify.get('/delivery/receipts', async (req) => {
    const tenantId = req.authContext.tenant_id
    const receipts = await db.collection('delivery_receipts')
      .find({ tenant_id: tenantId })
      .sort({ delivered_at: -1 })
      .limit(100)
      .toArray()
    return { receipts }
  })

  // ── AUTHENTICATED: Web push subscription management (D8) ────────────────
  // Browser push notifications via the Web Push API. The browser subscribes
  // by POSTing a PushSubscription (from service worker registration), and
  // unsubscribes by DELETEing with the endpoint.
  fastify.get('/delivery/push/vapid-public-key', async (_req, reply) => {
    const publicKey = process.env['VAPID_PUBLIC_KEY']
    if (!publicKey) return reply.status(503).send({ error: 'Web push not configured' })
    return { public_key: publicKey }
  })

  fastify.post<{
    Body: { endpoint: string; keys: { p256dh: string; auth: string } }
  }>('/delivery/push/subscribe', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const { endpoint, keys } = req.body ?? {}
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Missing endpoint or keys' })
    }
    await router.savePushSubscription(tenantId, { endpoint, keys })
    return reply.status(201).send({ ok: true })
  })

  fastify.delete<{
    Body: { endpoint: string }
  }>('/delivery/push/subscribe', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const { endpoint } = req.body ?? {}
    if (!endpoint) return reply.status(400).send({ error: 'Missing endpoint' })
    await router.removePushSubscription(tenantId, endpoint)
    return reply.send({ ok: true })
  })

  // ── AUTHENTICATED: Mobile (Expo) push token registration ────────────────
  // apps/kairos-mobile calls this after obtaining an Expo push token
  // (registerForPushNotificationsAsync). Registering is itself the opt-in —
  // see DeliveryRouter.enableMobilePush's comment for why there's no
  // separate preferences toggle.
  fastify.post<{
    Body: { token: string }
  }>('/delivery/push/mobile-subscribe', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const { token } = req.body ?? {}
    if (!token) return reply.status(400).send({ error: 'Missing token' })
    await router.saveMobilePushToken(tenantId, token)
    await router.enableMobilePush(tenantId)
    return reply.status(201).send({ ok: true })
  })

  fastify.delete<{
    Body: { token: string }
  }>('/delivery/push/mobile-subscribe', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const { token } = req.body ?? {}
    if (!token) return reply.status(400).send({ error: 'Missing token' })
    await router.removeMobilePushToken(tenantId, token)
    return reply.send({ ok: true })
  })

  // ── PUBLIC: WhatsApp inbound webhook ────────────────────────────────────
  // Maps reply text (YES/NO) to approve/dismiss action for a pending insight.
  fastify.post<{ Body: { From: string; Body: string } }>('/webhooks/whatsapp-reply', async (req, reply) => {
    const from = req.body.From?.replace('whatsapp:', '')
    const body = req.body.Body?.trim().toUpperCase()

    if (!from || !body) {
      return reply.status(400).send({ error: 'Missing From or Body' })
    }

    // Find tenant by WhatsApp number
    const tenant = await db.collection('tenant_settings').findOne({ whatsapp_to: from })
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found for this number' })
    }

    // Find most recent pending insight for this tenant
    const insight = await db.collection('insights').findOne(
      { tenant_id: tenant.tenant_id, state: 'identified' },
      { sort: { created_at: -1 } },
    )

    if (!insight) {
      return reply.status(404).send({ error: 'No pending insights found' })
    }

    const action = body === 'YES' ? 'approve' : body === 'NO' ? 'dismiss' : null
    if (!action) {
      return reply.status(400).send({ error: 'Reply must be YES or NO' })
    }

    const newState = action === 'approve' ? 'completed' : 'dismissed'
    await db.collection('insights').updateOne(
      { id: insight.id, tenant_id: tenant.tenant_id },
      {
        $set: {
          state: newState,
          [action === 'approve' ? 'approved_at' : 'dismissed_at']: new Date(),
          action_source: 'whatsapp',
        },
      },
    )

    return reply.send({ success: true, action, insight_id: insight.id })
  })
}

// ── HTML result page for one-click actions ─────────────────────────────────────

function actionResultPage(title: string, body: string, success: boolean): string {
  const color = success ? '#16a34a' : '#71717a'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Kairos</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#fff;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">
  <div style="max-width:400px;text-align:center;background:#0c0c0e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px 32px">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#6366f1;text-transform:uppercase;margin-bottom:24px">Kairos Studio</div>
    <div style="font-size:48px;margin-bottom:16px">${success ? '✅' : '👍'}</div>
    <h1 style="font-size:22px;font-weight:700;color:${color};margin:0 0 12px">${title}</h1>
    <p style="font-size:14px;color:#a1a1aa;line-height:1.6;margin:0">${body}</p>
  </div>
</body></html>`
}

function evidencePage(insight: Record<string, unknown>): string {
  const trail = (insight['evidence_trail'] ?? {}) as Record<string, unknown>
  const rule = (trail['rule_evidence'] ?? {}) as Record<string, unknown>
  const llm = trail['llm_evidence'] as Record<string, unknown> | undefined
  const matched = Object.entries((rule['matched_variables'] ?? {}) as Record<string, unknown>)
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(String(value))}</td></tr>`)
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Why this move — Kairos</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#e4e4e7;margin:0;padding:20px">
<main style="max-width:620px;margin:auto"><p style="color:#818cf8;font-weight:700">KAIROS · WHY THIS MOVE?</p>
<h1 style="color:white">${escapeHtml(String(insight['hypothesis'] ?? 'Move evidence'))}</h1>
<p style="line-height:1.6">${escapeHtml(String(trail['plain_english'] ?? insight['reasoning'] ?? ''))}</p>
<section style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px;margin-top:18px">
<h2 style="font-size:16px;color:white">Rule evidence</h2>
<p><strong>Condition:</strong> <code>${escapeHtml(String(rule['condition_expression'] ?? 'Unavailable'))}</code></p>
<p><strong>Threshold:</strong> ${escapeHtml(String(rule['threshold_used'] ?? 'Unavailable'))} · ${escapeHtml(String(rule['threshold_basis'] ?? ''))}</p>
<table style="width:100%;border-collapse:collapse">${matched}</table></section>
${llm ? `<section style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px;margin-top:12px"><h2 style="font-size:16px;color:white">AI enrichment</h2><p>AI score: ${escapeHtml(String(llm['llm_score']))} · Combined score: ${escapeHtml(String(llm['combined_score']))}</p></section>` : ''}
</main></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!)
}
