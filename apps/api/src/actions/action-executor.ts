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
 *   4. Record each execution as an ActionReceipt in MongoDB — idempotently:
 *      a receipt's payload_hash (insight + action content) is unique per
 *      tenant+insight, so re-running execute() for the same insight (e.g.
 *      via POST /insights/:id/retry-execution after a partial failure)
 *      skips any action that already has an 'executed'/'execution_skipped'
 *      receipt and only re-dispatches the ones that previously failed.
 *   5. Return a summary of succeeded / failed actions
 *
 * Supported action types (keyword → intent):
 *   "send * reminder"   → send_email (via SendGrid)
 *   "send * whatsapp"   → send_whatsapp (via Twilio)
 *   "escalate *"        → send_email with escalation flag
 *   "tag customer *"    → crm_tag
 *   Anything else       → log_only (recorded but not executed)
 *
 * Dry-run mode: set dryRun=true to record what would happen without executing.
 *
 * OAK-002 (2026-09-13): money-moving and public-publishing action types —
 * stripe_refund, stripe_pause, xero_credit_note, post_linkedin,
 * post_twitter — were deleted outright. POST /insights/:id/approve called
 * this executor unconditionally from a generic "Approve" click, with the
 * action type picked by regex keyword-matching an insight's free-text
 * label — meaning approving an insight could trigger a real Stripe refund,
 * cancel a live subscription, or publish publicly to LinkedIn/Twitter with
 * no per-action confirmation naming the exact side effect, amount, or
 * recipient. This is precisely the class of risk SECURITY.md already used
 * to justify deleting the old WorkflowEngine outright; this executor was
 * left wired into a currently-shipped route. See SECURITY.md for the full
 * writeup. send_email/send_whatsapp/crm_tag were kept — communication and
 * CRM-tagging, not money-moving or public-publishing, and not what this
 * finding was about.
 */

import type { Db, Collection } from 'mongodb'
import type { Insight } from '@agentoak/engine'
import type { ActionReceipt, ActionReceiptOutcome } from '@agentoak/workflows'
import { randomUUID, createHash } from 'node:crypto'

export type ActionType =
  | 'send_email'
  | 'send_whatsapp'
  | 'crm_tag'
  | 'log_only'

export interface ActionIntent {
  type: ActionType
  label: string          // original action string
  params: Record<string, unknown>
}

export type { ActionReceipt }

export interface ExecutionSummary {
  insight_id: string
  receipts: ActionReceipt[]
  succeeded: number
  failed: number
  skipped: number
}

/**
 * Classifies a dispatch failure by retryability, mirroring the distinction
 * ConnectorActionExecutor (@agentoak/workflows) already models for
 * connector calls: a 4xx or a "not connected"/config error is definite —
 * retrying won't help until the underlying cause is fixed — while a 5xx,
 * timeout, or network error is ambiguous and may be worth retrying as-is.
 */
function classifyDispatchError(err: unknown): Extract<ActionReceiptOutcome, 'execution_failed' | 'execution_ambiguous'> {
  const message = err instanceof Error ? err.message : String(err)
  const statusMatch = message.match(/\b([1-5]\d{2})\b/)
  if (statusMatch) return Number(statusMatch[1]) >= 500 ? 'execution_ambiguous' : 'execution_failed'
  if (/timeout|ETIMEDOUT|ECONNRESET|network/i.test(message)) return 'execution_ambiguous'
  return 'execution_failed'
}

// ── Action intent classifier ──────────────────────────────────────────────────
// Simple keyword rules — no LLM needed for this classification.

const ACTION_PATTERNS: Array<{ pattern: RegExp; type: ActionType }> = [
  { pattern: /send.*whatsapp|whatsapp.*message/i,               type: 'send_whatsapp' },
  { pattern: /send.*email|email.*remind|personalised.*remind/i, type: 'send_email' },
  { pattern: /escalate|cc.*manager|notify.*team/i,              type: 'send_email' },
  { pattern: /tag.*customer|crm.*tag|label.*contact/i,          type: 'crm_tag' },
]

function classifyAction(label: string): ActionType {
  for (const { pattern, type } of ACTION_PATTERNS) {
    if (pattern.test(label)) return type
  }
  return 'log_only'
}

// ── ActionExecutor ────────────────────────────────────────────────────────────

export class ActionExecutor {
  private col: Collection<ActionReceipt>

  constructor(private readonly db: Db) {
    this.col = db.collection<ActionReceipt>('action_receipts')
    this.col.createIndex({ insight_id: 1 }).catch(() => {})
    this.col.createIndex({ tenant_id: 1, executed_at: -1 }).catch(() => {})
    // Idempotency key — see db.ts's getReceiptsCollection for the canonical
    // creation; duplicated here defensively since ActionExecutor can be
    // constructed with its own injected Db before that path ever runs.
    this.col.createIndex({ tenant_id: 1, insight_id: 1, payload_hash: 1 }, { unique: true }).catch(() => {})
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
    }

    return {
      insight_id: insight.id,
      receipts,
      succeeded: receipts.filter(r => r.outcome === 'executed' || r.outcome === 'execution_skipped').length,
      failed:    receipts.filter(r => r.outcome === 'execution_failed' || r.outcome === 'execution_ambiguous').length,
      skipped:   receipts.filter(r => r.outcome === 'execution_skipped').length,
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
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ insight_id: insight.id, action_label: intent.label, action_type: intent.type }))
      .digest('hex')

    // Idempotency check: an 'executed'/'execution_skipped' receipt for this
    // exact action already exists (e.g. this is a retry-execution call) —
    // don't re-dispatch a side effect that already happened. A prior
    // 'execution_failed'/'execution_ambiguous' receipt is superseded below,
    // since that's exactly the case this retry path exists to resolve.
    const existing = await this.col.findOne({ tenant_id: tenantId, insight_id: insight.id, payload_hash: payloadHash })
    if (existing && (existing.outcome === 'executed' || existing.outcome === 'execution_skipped')) {
      return existing
    }
    if (existing) {
      await this.col.deleteOne({ id: existing.id })
    }

    const base: Omit<ActionReceipt, 'outcome' | 'outcome_reason'> = {
      id:           randomUUID(),
      insight_id:   insight.id,
      tenant_id:    tenantId,
      action_label: intent.label,
      action_type:  intent.type,
      executed_at:  new Date(),
      dry_run:      dryRun,
      payload_hash: payloadHash,
    }

    let receipt: ActionReceipt
    if (dryRun) {
      receipt = { ...base, outcome: 'execution_skipped', outcome_reason: 'dry_run' }
    } else if (intent.type === 'log_only') {
      receipt = { ...base, outcome: 'execution_skipped', outcome_reason: 'log_only' }
    } else {
      try {
        await this.dispatch(intent, insight, tenantId)
        receipt = { ...base, outcome: 'executed' }
      } catch (err) {
        receipt = { ...base, outcome: classifyDispatchError(err), outcome_reason: String(err) }
      }
    }

    // Awaited — a receipt that only exists in the HTTP response and never
    // reaches the DB is an audit-trail gap, not just a slow write. A
    // duplicate-key race here (concurrent retry) means another call already
    // recorded this action — defer to whatever it wrote.
    try {
      await this.col.insertOne(receipt)
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const winner = await this.col.findOne({ tenant_id: tenantId, insight_id: insight.id, payload_hash: payloadHash })
        if (winner) return winner
      }
      throw err
    }
    return receipt
  }

  // ── Dispatch to connector ─────────────────────────────────────────────────────

  private async dispatch(
    intent: ActionIntent,
    insight: Insight,
    tenantId: string,
  ): Promise<void> {
    switch (intent.type) {
      case 'send_email':
        await this.sendEmail(intent, insight, tenantId)
        break
      case 'send_whatsapp':
        await this.sendWhatsApp(intent, insight, tenantId)
        break
      case 'crm_tag':
        await this.crmTag(intent, insight, tenantId)
        break
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

    const { decryptIfNeeded } = await import('@agentoak/platform')
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

    const { decryptIfNeeded } = await import('@agentoak/platform')
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

  private async crmTag(_intent: ActionIntent, insight: Insight, tenantId: string): Promise<void> {
    const creds = await this.getCredential(tenantId, 'hubspot')
    if (!creds?.api_key) throw new Error('HubSpot not connected')
    const { decryptIfNeeded } = await import('@agentoak/platform')
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
