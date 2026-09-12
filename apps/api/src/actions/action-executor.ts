/**
 * Action Executor — runs the recommended actions on an approved insight.
 *
 * Maps free-text action strings to executable connector calls using
 * keyword matching + a structured action registry.
 *
 * Architecture:
 *   1. Parse each action string into an ActionIntent (type + params)
 *   2. Look up the tenant's connected connector for that action type
 *   3. Execute via ConnectorActionExecutor (already wired in platform)
 *   4. Record each execution as an ActionReceipt in MongoDB
 *   5. Return a summary of succeeded / failed actions
 *
 * Supported action types (keyword → intent):
 *   "send * reminder"   → send_email (via SendGrid)
 *   "send * whatsapp"   → send_whatsapp (via Twilio)
 *   "escalate *"        → send_email with escalation flag
 *   "create * note"     → xero_credit_note
 *   "refund *"          → stripe_refund
 *   "tag customer *"    → crm_tag
 *   "pause subscription*"→ stripe_pause
 *   Anything else       → log_only (recorded but not executed)
 *
 * Dry-run mode: set dryRun=true to record what would happen without executing.
 */

import type { Db } from 'mongodb'
import type { Insight } from '@kairos/engine'
import { randomUUID } from 'node:crypto'

export type ActionType =
  | 'send_email'
  | 'send_whatsapp'
  | 'xero_credit_note'
  | 'stripe_refund'
  | 'stripe_pause'
  | 'crm_tag'
  | 'post_linkedin'
  | 'post_twitter'
  | 'log_only'

export interface ActionIntent {
  type: ActionType
  label: string          // original action string
  params: Record<string, unknown>
}

export interface ActionReceipt {
  id: string
  insight_id: string
  tenant_id: string
  action_label: string
  action_type: ActionType
  status: 'success' | 'failed' | 'skipped' | 'dry_run'
  executed_at: Date
  error?: string
  dry_run: boolean
  /**
   * External platform ID returned by the action API.
   * LinkedIn: urn:li:share:1234567890
   * Twitter:  tweet_id string
   * Stored so the analytics polling job can later fetch performance metrics.
   */
  external_id?: string
  external_platform?: string
}

export interface ExecutionSummary {
  insight_id: string
  receipts: ActionReceipt[]
  succeeded: number
  failed: number
  skipped: number
}

// ── Action intent classifier ──────────────────────────────────────────────────
// Simple keyword rules — no LLM needed for this classification.

const ACTION_PATTERNS: Array<{ pattern: RegExp; type: ActionType }> = [
  { pattern: /send.*whatsapp|whatsapp.*message/i,               type: 'send_whatsapp' },
  { pattern: /send.*email|email.*remind|personalised.*remind/i, type: 'send_email' },
  { pattern: /escalate|cc.*manager|notify.*team/i,              type: 'send_email' },
  { pattern: /credit\s*note|xero.*note/i,                       type: 'xero_credit_note' },
  { pattern: /refund|stripe.*refund/i,                          type: 'stripe_refund' },
  { pattern: /pause.*subscript|subscript.*pause/i,              type: 'stripe_pause' },
  { pattern: /tag.*customer|crm.*tag|label.*contact/i,          type: 'crm_tag' },
  { pattern: /post.*linkedin|linkedin.*post|publish.*linkedin/i, type: 'post_linkedin' },
  { pattern: /post.*twitter|tweet|publish.*twitter|thread/i,     type: 'post_twitter' },
]

function classifyAction(label: string): ActionType {
  for (const { pattern, type } of ACTION_PATTERNS) {
    if (pattern.test(label)) return type
  }
  return 'log_only'
}

// ── ActionExecutor ────────────────────────────────────────────────────────────

export class ActionExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any

  constructor(private readonly db: Db) {
    this.col = db.collection('action_receipts')
    this.col.createIndex({ insight_id: 1 }).catch(() => {})
    this.col.createIndex({ tenant_id: 1, executed_at: -1 }).catch(() => {})
  }

  async execute(
    insight: Insight,
    tenantId: string,
    opts: { dryRun?: boolean; approvedBy?: string } = {},
  ): Promise<ExecutionSummary> {
    const { dryRun = false } = opts
    const receipts: ActionReceipt[] = []

    for (const actionLabel of insight.actions) {
      const type = classifyAction(actionLabel)
      const receipt = await this.runAction({
        insight,
        tenantId,
        intent: { type, label: actionLabel, params: { approved_by: opts.approvedBy } },
        dryRun,
      })
      receipts.push(receipt)
      // Awaited — a receipt that only exists in the HTTP response and never
      // reaches the DB is an audit-trail gap, not just a slow write.
      await this.col.insertOne(receipt)
    }

    return {
      insight_id: insight.id,
      receipts,
      succeeded: receipts.filter(r => r.status === 'success' || r.status === 'dry_run').length,
      failed:    receipts.filter(r => r.status === 'failed').length,
      skipped:   receipts.filter(r => r.status === 'skipped').length,
    }
  }

  /** Return all action receipts for an insight (for the approve response + audit). */
  async getReceipts(insightId: string): Promise<ActionReceipt[]> {
    return this.col.find({ insight_id: insightId }).sort({ executed_at: 1 }).toArray()
  }

  // ── Private: execute a single intent ─────────────────────────────────────────

  private async runAction(opts: {
    insight: Insight
    tenantId: string
    intent: ActionIntent
    dryRun: boolean
  }): Promise<ActionReceipt> {
    const { insight, tenantId, intent, dryRun } = opts
    const base: Omit<ActionReceipt, 'status' | 'error'> = {
      id:           randomUUID(),
      insight_id:   insight.id,
      tenant_id:    tenantId,
      action_label: intent.label,
      action_type:  intent.type,
      executed_at:  new Date(),
      dry_run:      dryRun,
    }

    if (dryRun) return { ...base, status: 'dry_run' }
    if (intent.type === 'log_only') return { ...base, status: 'skipped' }

    try {
      const result = await this.dispatch(intent, insight, tenantId)
      return {
        ...base,
        status: 'success',
        ...(result?.external_id && { external_id: result.external_id }),
        ...(result?.external_platform && { external_platform: result.external_platform }),
      }
    } catch (err) {
      return { ...base, status: 'failed', error: String(err) }
    }
  }

  // ── Dispatch to connector ─────────────────────────────────────────────────────

  private async dispatch(
    intent: ActionIntent,
    insight: Insight,
    tenantId: string,
  ): Promise<{ external_id?: string; external_platform?: string } | void> {
    switch (intent.type) {
      case 'send_email':
        await this.sendEmail(intent, insight, tenantId)
        break
      case 'send_whatsapp':
        await this.sendWhatsApp(intent, insight, tenantId)
        break
      case 'xero_credit_note':
        await this.createXeroCreditNote(intent, insight, tenantId)
        break
      case 'stripe_refund':
        await this.stripeRefund(intent, insight, tenantId)
        break
      case 'stripe_pause':
        await this.stripePause(intent, insight, tenantId)
        break
      case 'crm_tag':
        await this.crmTag(intent, insight, tenantId)
        break
      case 'post_linkedin':
        return this.postLinkedIn(intent, insight, tenantId)
      case 'post_twitter':
        return this.postTwitter(intent, insight, tenantId)
      default:
        // log_only — already handled
    }
  }

  // ── Action implementations ────────────────────────────────────────────────────
  // Each fetches the tenant's connector credential and calls the provider API.
  // Credentials are retrieved from connector_credentials collection (AES-256-GCM encrypted).

  private async sendEmail(intent: ActionIntent, insight: Insight, tenantId: string): Promise<void> {
    const creds = await this.getCredential(tenantId, 'sendgrid')
    if (!creds?.api_key) throw new Error('SendGrid not connected')

    const { decryptIfNeeded } = await import('@kairos/platform')
    const apiKey = decryptIfNeeded(creds.api_key as string)
    if (!apiKey) throw new Error('SendGrid API key missing')

    const recipientEmail = await this.getTenantContactEmail(tenantId)

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: recipientEmail }] }],
        from: { email: 'insights@kairos.dev', name: 'Kairos' },
        subject: `Action recommended: ${intent.label}`,
        content: [{
          type: 'text/plain',
          value: `${insight.reasoning}\n\nAction: ${intent.label}\n\nEstimated impact: £${Math.round(insight.estimated_impact_low / 100)}–£${Math.round(insight.estimated_impact_high / 100)}`,
        }],
      }),
    })
    if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`)
  }

  private async sendWhatsApp(intent: ActionIntent, insight: Insight, tenantId: string): Promise<void> {
    const creds = await this.getCredential(tenantId, 'twilio')
    if (!creds?.account_sid || !creds?.auth_token) throw new Error('Twilio not connected')

    const { decryptIfNeeded } = await import('@kairos/platform')
    const sid = decryptIfNeeded(creds.account_sid as string)
    const token = decryptIfNeeded(creds.auth_token as string)
    const toPhone = creds.whatsapp_to as string | undefined
    if (!sid || !token || !toPhone) throw new Error('Twilio WhatsApp config incomplete')

    const body = new URLSearchParams({
      From: `whatsapp:${creds.whatsapp_from as string}`,
      To: `whatsapp:${toPhone}`,
      Body: `${intent.label}: ${insight.reasoning.slice(0, 200)}`,
    })
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
      body,
    })
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`)
  }

  private async createXeroCreditNote(_intent: ActionIntent, insight: Insight, tenantId: string): Promise<void> {
    const creds = await this.getCredential(tenantId, 'xero')
    if (!creds?.access_token) throw new Error('Xero not connected')
    const { decryptIfNeeded } = await import('@kairos/platform')
    const token = decryptIfNeeded(creds.access_token as string)
    if (!token) throw new Error('Xero access token missing')
    // Post a minimal credit note — in production this would carry line items from the insight's evidence_refs
    const res = await fetch('https://api.xero.com/api.xro/2.0/CreditNotes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        CreditNotes: [{
          Type: 'ACCREC',
          Contact: { Name: 'Kairos Auto-action' },
          Date: new Date().toISOString().split('T')[0],
          LineAmountTypes: 'Exclusive',
          LineItems: [{
            Description: insight.reasoning.slice(0, 200),
            UnitAmount: insight.estimated_impact_low / 100,
            AccountCode: '200',
          }],
        }],
      }),
    })
    if (!res.ok) throw new Error(`Xero ${res.status}: ${await res.text()}`)
  }

  private async stripeRefund(_intent: ActionIntent, insight: Insight, tenantId: string): Promise<void> {
    const creds = await this.getCredential(tenantId, 'stripe')
    if (!creds?.api_key) throw new Error('Stripe not connected')
    const { decryptIfNeeded } = await import('@kairos/platform')
    const apiKey = decryptIfNeeded(creds.api_key as string)
    if (!apiKey) throw new Error('Stripe key missing')
    // The evidence_refs should contain a charge/payment_intent ID — use first one
    const chargeId = insight.confidence_breakdown.evidence_refs[0]
    if (!chargeId || !chargeId.startsWith('ch_')) throw new Error('No Stripe charge ID in evidence_refs')
    const body = new URLSearchParams({ charge: chargeId, amount: String(insight.estimated_impact_low) })
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    })
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`)
  }

  private async stripePause(_intent: ActionIntent, insight: Insight, tenantId: string): Promise<void> {
    const creds = await this.getCredential(tenantId, 'stripe')
    if (!creds?.api_key) throw new Error('Stripe not connected')
    const { decryptIfNeeded } = await import('@kairos/platform')
    const apiKey = decryptIfNeeded(creds.api_key as string)
    const subId = insight.confidence_breakdown.evidence_refs[0]
    if (!apiKey || !subId?.startsWith('sub_')) throw new Error('No Stripe subscription ID in evidence_refs')
    const body = new URLSearchParams({ 'pause_collection[behavior]': 'void' })
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    })
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`)
  }

  private async crmTag(_intent: ActionIntent, insight: Insight, tenantId: string): Promise<void> {
    const creds = await this.getCredential(tenantId, 'hubspot')
    if (!creds?.api_key) throw new Error('HubSpot not connected')
    const { decryptIfNeeded } = await import('@kairos/platform')
    const apiKey = decryptIfNeeded(creds.api_key as string)
    const contactId = insight.confidence_breakdown.evidence_refs[0]
    if (!apiKey || !contactId) throw new Error('No HubSpot contact ID in evidence_refs')
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { kairos_insight: insight.hypothesis, kairos_insight_at: new Date().toISOString() } }),
    })
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`)
  }

  // ── Social publishing — returns external_id for analytics polling ─────────────

  private async postLinkedIn(
    intent: ActionIntent,
    insight: Insight,
    tenantId: string,
  ): Promise<{ external_id: string; external_platform: string }> {
    const creds = await this.getCredential(tenantId, 'linkedin')
    if (!creds?.access_token) throw new Error('LinkedIn not connected')
    const { decryptIfNeeded } = await import('@kairos/platform')
    const token = decryptIfNeeded(creds.access_token as string)
    if (!token) throw new Error('LinkedIn access token missing')

    const authorUrn = creds.author_urn as string | undefined
    if (!authorUrn) throw new Error('LinkedIn author URN not configured (set in connector settings)')

    const text = (intent.params['post_text'] as string | undefined) ?? insight.reasoning

    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }

    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${await res.text()}`)

    // LinkedIn returns the post URN in the X-RestLi-Id header
    const postUrn = res.headers.get('x-restli-id') ?? res.headers.get('X-RestLi-Id') ?? ''
    return { external_id: postUrn, external_platform: 'linkedin' }
  }

  private async postTwitter(
    intent: ActionIntent,
    insight: Insight,
    tenantId: string,
  ): Promise<{ external_id: string; external_platform: string }> {
    const creds = await this.getCredential(tenantId, 'twitter_x')
    if (!creds?.access_token) throw new Error('Twitter/X not connected')
    const { decryptIfNeeded } = await import('@kairos/platform')
    const token = decryptIfNeeded(creds.access_token as string)
    if (!token) throw new Error('Twitter access token missing')

    const text = ((intent.params['post_text'] as string | undefined) ?? insight.reasoning).slice(0, 280)

    const res = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(`Twitter ${res.status}: ${await res.text()}`)

    const data = await res.json() as { data?: { id: string } }
    const tweetId = data.data?.id ?? ''
    return { external_id: tweetId, external_platform: 'twitter' }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async getCredential(tenantId: string, connectorId: string): Promise<Record<string, unknown> | null> {
    return this.db.collection('connector_credentials').findOne(
      { tenant_id: tenantId, connector_id: connectorId },
    ) as Promise<Record<string, unknown> | null>
  }

  private async getTenantContactEmail(tenantId: string): Promise<string> {
    const settings = await this.db.collection('tenant_settings').findOne({ tenant_id: tenantId }) as { contact_email?: string } | null
    return settings?.contact_email ?? `ops+${tenantId}@kairos.dev`
  }
}
