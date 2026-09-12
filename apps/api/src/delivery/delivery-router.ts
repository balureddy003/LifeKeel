/**
 * DeliveryRouter — routes insights to the right channel for each tenant.
 *
 * Responsibilities:
 *   1. Load per-tenant delivery preferences (channels, contact, urgency floor)
 *   2. Generate signed one-click approve/dismiss tokens (no login required)
 *   3. Select channel by priority + urgency
 *   4. Dispatch with retry + fallback (WhatsApp → SMS → Email)
 *   5. Dedup — never deliver the same insight twice per channel
 *   6. Record delivery receipts for audit + attribution
 *
 * The "push-first, no dashboard login" promise lives here: a business owner
 * receives a WhatsApp message, taps Approve, and the action executes — they
 * never open the Studio.
 */

import crypto from 'node:crypto'
import type { Insight, JudgeVerdict, MoveJudge } from '@agentoak/engine'
import {
  WhatsAppChannel, SmsChannel, EmailChannel, WebPushChannel, MobilePushChannel, RealMobilePushSender,
  type InsightNotification, type DeliveryResult,
} from './channels.js'
import { RealWebPushSender, type WebPushSubscription } from './web-push-sender.js'
import { recordDeliveryLatency } from '../routes/metrics.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any }

export type Channel = 'whatsapp' | 'sms' | 'email' | 'web_push' | 'mobile_push'

export interface DeliveryPreferences {
  tenant_id: string
  /** Ordered channel priority. First available wins; falls through on failure. */
  channels: Channel[]
  /** Contact endpoints per channel. */
  whatsapp_to?: string        // E.164 phone, e.g. +447700900123
  sms_to?: string
  email_to?: string
  /** Web push subscription endpoint (stored separately in web_push_subscriptions). */
  web_push_enabled?: boolean
  /** Expo push token(s) (stored separately in mobile_push_tokens). */
  mobile_push_enabled?: boolean
  /** Only deliver insights at or above this urgency. */
  min_urgency: 'critical' | 'high' | 'medium' | 'low'
  /** From-name shown in email + WhatsApp. */
  business_name?: string
  /** Quiet hours — no push between these (24h, tenant local). null = always on. */
  quiet_hours_start?: number | null   // e.g. 21
  quiet_hours_end?: number | null     // e.g. 8
  /** Digest mode — batch low-urgency into a daily summary instead of per-insight. */
  digest_mode?: boolean
  enabled: boolean
}

const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

export class DeliveryRouter {
  private readonly db: Db
  private readonly signingSecret: string
  private readonly studioBaseUrl: string
  private readonly apiBaseUrl: string
  private readonly moveJudge: MoveJudge | undefined

  private whatsapp = new WhatsAppChannel()
  private sms = new SmsChannel()
  private email = new EmailChannel()
  private webPush: WebPushChannel | undefined
  // Unlike WebPush, Expo's push API needs no per-tenant key/config — the
  // token itself routes the notification — so this is always wired.
  private mobilePush = new MobilePushChannel(new RealMobilePushSender())

  constructor(db: Db, moveJudge?: MoveJudge) {
    this.db = db
    this.moveJudge = moveJudge
    this.signingSecret = process.env['DELIVERY_SIGNING_SECRET'] ?? process.env['JWT_SECRET'] ?? 'change-me'
    this.studioBaseUrl = process.env['STUDIO_BASE_URL'] ?? 'http://localhost:3000'
    this.apiBaseUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'

    // Wire web push channel only if VAPID keys are configured
    const sender = new RealWebPushSender()
    if (sender.isConfigured()) {
      this.webPush = new WebPushChannel(sender)
    }
  }

  // ─── Web push subscription management ──────────────────────────────────────

  async savePushSubscription(tenantId: string, subscription: WebPushSubscription): Promise<void> {
    await this.db.collection('web_push_subscriptions').updateOne(
      { tenant_id: tenantId, endpoint: subscription.endpoint },
      { $set: { tenant_id: tenantId, ...subscription, subscribed_at: new Date() } },
      { upsert: true },
    )
  }

  async removePushSubscription(tenantId: string, endpoint: string): Promise<void> {
    await this.db.collection('web_push_subscriptions').deleteOne({ tenant_id: tenantId, endpoint })
  }

  async getPushSubscriptions(tenantId: string): Promise<WebPushSubscription[]> {
    const subs = await this.db.collection('web_push_subscriptions')
      .find({ tenant_id: tenantId })
      .toArray() as unknown as WebPushSubscription[]
    return subs
  }

  // ─── Mobile (Expo) push token management ───────────────────────────────────

  async saveMobilePushToken(tenantId: string, token: string): Promise<void> {
    await this.db.collection('mobile_push_tokens').updateOne(
      { tenant_id: tenantId, token },
      { $set: { tenant_id: tenantId, token, subscribed_at: new Date() } },
      { upsert: true },
    )
  }

  async removeMobilePushToken(tenantId: string, token: string): Promise<void> {
    await this.db.collection('mobile_push_tokens').deleteOne({ tenant_id: tenantId, token })
  }

  async getMobilePushTokens(tenantId: string): Promise<string[]> {
    const docs = await this.db.collection('mobile_push_tokens')
      .find({ tenant_id: tenantId })
      .toArray() as unknown as { token: string }[]
    return docs.map((d) => d.token)
  }

  /**
   * Registering a device token from the app is itself the opt-in gesture
   * (granting OS notification permission already required explicit user
   * action) — there's no separate delivery-preferences screen in Kairos the
   * way Studio has one, so this surgically ensures 'mobile_push' is in the
   * tenant's channel list rather than requiring a settings UI that doesn't
   * exist yet. Preserves every other existing preference untouched.
   */
  async enableMobilePush(tenantId: string): Promise<void> {
    await this.db.collection('delivery_preferences').updateOne(
      { tenant_id: tenantId },
      {
        $addToSet: { channels: 'mobile_push' },
        $set: { mobile_push_enabled: true, enabled: true, updated_at: new Date() },
        $setOnInsert: { tenant_id: tenantId, min_urgency: 'high' },
      },
      { upsert: true },
    )
  }

  // ─── Signed action tokens (no login required) ──────────────────────────────

  /**
   * Generate a signed, time-limited token encoding {insight_id, tenant_id, action}.
   * The token is verified by the public action endpoint — no JWT/login needed.
   * HMAC-SHA256 prevents forgery; expiry limits replay window.
   */
  signActionToken(insightId: string, tenantId: string, action: 'approve' | 'dismiss'): string {
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000  // 7 days
    const payload = `${insightId}:${tenantId}:${action}:${expiresAt}`
    const sig = crypto.createHmac('sha256', this.signingSecret).update(payload).digest('base64url')
    const token = Buffer.from(`${payload}:${sig}`).toString('base64url')
    return token
  }

  /** Verify a signed action token. Returns the decoded action or null if invalid/expired. */
  verifyActionToken(token: string): { insight_id: string; tenant_id: string; action: 'approve' | 'dismiss' } | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString()
      const parts = decoded.split(':')
      if (parts.length !== 5) return null
      const insightId = parts[0] ?? ''
      const tenantId = parts[1] ?? ''
      const action = parts[2] ?? ''
      const expiresAtStr = parts[3] ?? ''
      const sig = parts[4] ?? ''
      const payload = `${insightId}:${tenantId}:${action}:${expiresAtStr}`
      const expected = crypto.createHmac('sha256', this.signingSecret).update(payload).digest('base64url')
      // Constant-time comparison
      if (sig.length !== expected.length) return null
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
      if (Date.now() > parseInt(expiresAtStr)) return null
      if (action !== 'approve' && action !== 'dismiss') return null
      return { insight_id: insightId, tenant_id: tenantId, action }
    } catch {
      return null
    }
  }

  signEvidenceToken(insightId: string, tenantId: string): string {
    return this.signScopedToken(insightId, tenantId, 'evidence')
  }

  verifyEvidenceToken(token: string): { insight_id: string; tenant_id: string } | null {
    const decoded = this.verifyScopedToken(token, 'evidence')
    return decoded ? { insight_id: decoded.insight_id, tenant_id: decoded.tenant_id } : null
  }

  private signScopedToken(insightId: string, tenantId: string, scope: string): string {
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
    const payload = `${insightId}:${tenantId}:${scope}:${expiresAt}`
    const sig = crypto.createHmac('sha256', this.signingSecret).update(payload).digest('base64url')
    return Buffer.from(`${payload}:${sig}`).toString('base64url')
  }

  private verifyScopedToken(token: string, scope: string): { insight_id: string; tenant_id: string } | null {
    try {
      const parts = Buffer.from(token, 'base64url').toString().split(':')
      if (parts.length !== 5 || parts[2] !== scope) return null
      const payload = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}`
      const expected = crypto.createHmac('sha256', this.signingSecret).update(payload).digest('base64url')
      if (!parts[4] || parts[4].length !== expected.length) return null
      if (!crypto.timingSafeEqual(Buffer.from(parts[4]), Buffer.from(expected))) return null
      if (Date.now() > Number(parts[3])) return null
      return { insight_id: parts[0] ?? '', tenant_id: parts[1] ?? '' }
    } catch {
      return null
    }
  }

  // ─── Preference loading ────────────────────────────────────────────────────

  async getPreferences(tenantId: string): Promise<DeliveryPreferences | null> {
    const prefs = await this.db.collection('delivery_preferences').findOne({ tenant_id: tenantId })
    return prefs as DeliveryPreferences | null
  }

  async savePreferences(prefs: DeliveryPreferences): Promise<void> {
    await this.db.collection('delivery_preferences').updateOne(
      { tenant_id: prefs.tenant_id },
      { $set: { ...prefs, updated_at: new Date() } },
      { upsert: true },
    )
  }

  // ─── Quiet hours check ─────────────────────────────────────────────────────

  private inQuietHours(prefs: DeliveryPreferences): boolean {
    if (prefs.quiet_hours_start == null || prefs.quiet_hours_end == null) return false
    const hour = new Date().getHours()
    const { quiet_hours_start: start, quiet_hours_end: end } = prefs
    // Handle overnight window (e.g. 21 → 8)
    if (start > end) return hour >= start || hour < end
    return hour >= start && hour < end
  }

  // ─── Dedup ─────────────────────────────────────────────────────────────────

  private async alreadyDelivered(insightId: string, channel: Channel): Promise<boolean> {
    const existing = await this.db.collection('delivery_receipts').findOne({
      insight_id: insightId,
      channel,
      success: true,
    })
    return existing !== null
  }

  // ─── Build notification payload ────────────────────────────────────────────

  private buildNotification(
    insight: Record<string, unknown>,
    tenantId: string,
  ): InsightNotification {
    const insightId = insight['id'] as string
    const cb = (insight['confidence_breakdown'] ?? {}) as Record<string, number>
    const impact = (insight['estimated_impact'] ?? {}) as Record<string, number>

    return {
      insight_id: insightId,
      tenant_id: tenantId,
      hypothesis: this.humanize(insight['hypothesis'] as string ?? 'Opportunity'),
      urgency: (insight['urgency'] as InsightNotification['urgency']) ?? 'medium',
      or_score: cb['or_score'] ?? 0,
      ...(impact['low'] !== undefined ? { estimated_impact_low: impact['low'] } : {}),
      ...(impact['high'] !== undefined ? { estimated_impact_high: impact['high'] } : {}),
      currency: (insight['currency'] as string) ?? 'GBP',
      ...(insight['reasoning'] ? { reasoning: insight['reasoning'] as string } : {}),
      ...(Array.isArray(insight['recommended_actions'])
        ? { recommended_actions: insight['recommended_actions'] as string[] }
        : {}),
      action_url: `${this.studioBaseUrl}/?insight=${insightId}`,
      approve_url: `${this.apiBaseUrl}/a/${this.signActionToken(insightId, tenantId, 'approve')}`,
      dismiss_url: `${this.apiBaseUrl}/a/${this.signActionToken(insightId, tenantId, 'dismiss')}`,
      why_url: `${this.apiBaseUrl}/why/${this.signEvidenceToken(insightId, tenantId)}`,
    }
  }

  private humanize(s: string): string {
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  // ─── Main dispatch ─────────────────────────────────────────────────────────

  /**
   * Deliver one insight to a tenant via the highest-priority available channel,
   * falling through on failure. Returns the successful DeliveryResult or the
   * last failure.
   */
  async deliver(insight: Record<string, unknown>, tenantId: string): Promise<DeliveryResult | null> {
    const prefs = await this.getPreferences(tenantId)
    if (!prefs || !prefs.enabled) return null

    // Urgency floor
    const insightUrgency = (insight['urgency'] as string) ?? 'medium'
    if ((URGENCY_RANK[insightUrgency] ?? 0) < (URGENCY_RANK[prefs.min_urgency] ?? 0)) return null

    // Quiet hours — defer non-critical
    if (this.inQuietHours(prefs) && insightUrgency !== 'critical') {
      await this.queueForDigest(insight, tenantId)
      return null
    }

    // Digest mode — batch low/medium
    if (prefs.digest_mode && (insightUrgency === 'low' || insightUrgency === 'medium')) {
      await this.queueForDigest(insight, tenantId)
      return null
    }

    if (!await this.passesMoveJudge(insight, tenantId)) return null

    const notification = this.buildNotification(insight, tenantId)
    let lastResult: DeliveryResult | null = null

    for (const channel of prefs.channels) {
      // Dedup per channel
      if (await this.alreadyDelivered(notification.insight_id, channel)) continue

      let result: DeliveryResult
      if (channel === 'whatsapp' && prefs.whatsapp_to) {
        result = await this.whatsapp.send(prefs.whatsapp_to, notification)
      } else if (channel === 'sms' && prefs.sms_to) {
        result = await this.sms.send(prefs.sms_to, notification)
      } else if (channel === 'email' && prefs.email_to) {
        result = await this.email.send(prefs.email_to, prefs.business_name ?? 'Kairos', notification)
      } else if (channel === 'web_push' && this.webPush && prefs.web_push_enabled) {
        // Send to all subscribed devices for this tenant
        const subs = await this.getPushSubscriptions(tenantId)
        if (subs.length === 0) { continue }
        let pushResult: DeliveryResult | null = null
        for (const sub of subs) {
          pushResult = await this.webPush.send(sub, notification)
          if (pushResult.success) break // stop at first successful device
        }
        result = pushResult ?? { channel: 'web_push', success: false, error: 'No subscriptions', delivered_at: new Date() }
      } else if (channel === 'mobile_push' && prefs.mobile_push_enabled) {
        const tokens = await this.getMobilePushTokens(tenantId)
        if (tokens.length === 0) { continue }
        let pushResult: DeliveryResult | null = null
        for (const token of tokens) {
          pushResult = await this.mobilePush.send(token, notification)
          if (pushResult.success) break // stop at first successful device
        }
        result = pushResult ?? { channel: 'mobile_push', success: false, error: 'No tokens', delivered_at: new Date() }
      } else {
        continue  // channel not configured
      }

      await this.recordReceipt(notification.insight_id, tenantId, result)
      const createdAt = insight['created_at']
      if (createdAt instanceof Date) {
        recordDeliveryLatency(Math.max(0, (Date.now() - createdAt.getTime()) / 1000))
      }
      lastResult = result

      if (result.success) return result  // stop at first success
      // else fall through to next channel
    }

    return lastResult
  }

  private async passesMoveJudge(insight: Record<string, unknown>, tenantId: string): Promise<boolean> {
    if (!this.moveJudge || typeof insight['id'] !== 'string') return true

    const reasoning = typeof insight['reasoning'] === 'string' ? insight['reasoning'] : ''
    const reasoningHash = crypto.createHash('sha256').update(reasoning.trim()).digest('hex')
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const duplicate = await this.db.collection('move_judge_verdicts').findOne({
      tenant_id: tenantId,
      reasoning_hash: reasoningHash,
      evaluated_at: { $gte: since },
    })

    const verdict = await this.moveJudge.evaluate({
      insight: insight as unknown as Insight,
      evidence: {
        evidence_refs: (insight['confidence_breakdown'] as Record<string, unknown> | undefined)?.['evidence_refs'] ?? [],
        feature_snapshot: insight['feature_snapshot'] ?? {},
        derived_from_signals: insight['derived_from_signals'] ?? [],
      },
    }, { duplicateReasoning: duplicate !== null })

    await this.persistJudgeVerdict(insight, tenantId, reasoningHash, verdict)
    if (verdict.decision === 'pass' || verdict.decision === 'skipped') return true

    const queue = verdict.decision === 'rewrite' ? 'move_rewrite_queue' : 'manual_review_queue'
    await this.db.collection(queue).updateOne(
      { tenant_id: tenantId, insight_id: insight['id'] },
      {
        $set: {
          tenant_id: tenantId,
          insight_id: insight['id'],
          detector_id: insight['detector_id'],
          verdict,
          status: 'pending',
          ...(verdict.decision === 'rewrite'
            ? { retry_at: new Date() }
            : { re_evaluate_at: new Date(Date.now() + 4 * 60 * 60 * 1000) }),
          updated_at: new Date(),
        },
      },
      { upsert: true },
    )
    return false
  }

  private async persistJudgeVerdict(
    insight: Record<string, unknown>,
    tenantId: string,
    reasoningHash: string,
    verdict: JudgeVerdict,
  ): Promise<void> {
    await this.db.collection('move_judge_verdicts').insertOne({
      tenant_id: tenantId,
      insight_id: insight['id'],
      detector_id: insight['detector_id'],
      reasoning_hash: reasoningHash,
      ...verdict,
    })
    await this.db.collection('insights').updateOne(
      { tenant_id: tenantId, id: insight['id'] },
      { $set: { judge_verdict: verdict } },
    )
    insight['judge_verdict'] = verdict
  }

  // ─── Digest queue ──────────────────────────────────────────────────────────

  private async queueForDigest(insight: Record<string, unknown>, tenantId: string): Promise<void> {
    await this.db.collection('digest_queue').insertOne({
      tenant_id: tenantId,
      insight_id: insight['id'],
      insight,
      queued_at: new Date(),
      sent: false,
    })
  }

  /** Send a daily digest email of all queued insights for a tenant. */
  async sendDigest(tenantId: string): Promise<DeliveryResult | null> {
    const prefs = await this.getPreferences(tenantId)
    if (!prefs || !prefs.enabled || !prefs.email_to) return null

    const queued = await this.db.collection('digest_queue')
      .find({ tenant_id: tenantId, sent: false })
      .toArray() as Array<{ insight: Record<string, unknown>; _id: unknown }>

    if (queued.length === 0) return null

    // Build a digest notification (summary of N insights)
    const totalImpact = queued.reduce((sum, q) => {
      const impact = (q.insight['estimated_impact'] ?? {}) as Record<string, number>
      return sum + (impact['high'] ?? 0)
    }, 0)

    const digestNotification: InsightNotification = {
      insight_id: `digest_${Date.now()}`,
      tenant_id: tenantId,
      hypothesis: `${queued.length} new opportunities today`,
      urgency: 'medium',
      or_score: 1,
      estimated_impact_high: totalImpact,
      currency: 'GBP',
      reasoning: `You have ${queued.length} opportunities worth up to ${(totalImpact / 100).toFixed(0)} in total. Open Kairos to review them all.`,
      action_url: `${this.studioBaseUrl}/`,
      approve_url: `${this.studioBaseUrl}/`,
      dismiss_url: `${this.studioBaseUrl}/`,
    }

    const result = await this.email.send(prefs.email_to, prefs.business_name ?? 'Kairos', digestNotification)

    if (result.success) {
      const ids = queued.map(q => q._id)
      await this.db.collection('digest_queue').updateMany(
        { _id: { $in: ids } },
        { $set: { sent: true, sent_at: new Date() } },
      )
    }
    return result
  }

  // ─── Receipt recording (audit + attribution) ───────────────────────────────

  private async recordReceipt(insightId: string, tenantId: string, result: DeliveryResult): Promise<void> {
    await this.db.collection('delivery_receipts').insertOne({
      insight_id: insightId,
      tenant_id: tenantId,
      channel: result.channel,
      success: result.success,
      external_id: result.external_id ?? null,
      error: result.error ?? null,
      delivered_at: result.delivered_at,
    })
  }
}
