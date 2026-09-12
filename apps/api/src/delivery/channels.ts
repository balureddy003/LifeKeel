/**
 * Delivery Channels — WhatsApp, SMS, Email
 *
 * Three channel implementations behind a common DeliveryChannel interface.
 * All channels are fire-and-forget with structured error returns (no throws).
 *
 * Channel selection priority (configurable per tenant):
 *   1. WhatsApp Business (Twilio) — richest format, free on-thread reply
 *   2. SMS (Twilio)               — universal fallback, no app required
 *   3. Email (SendGrid)           — for detailed breakdowns, digest mode
 *
 * All channels share the same InsightNotification payload so the caller
 * doesn't need channel-specific logic.
 */

import twilio from 'twilio'
import sgMail from '@sendgrid/mail'
import { formatMoney } from '@kairos/platform'

// ── Shared types ───────────────────────────────────────────────────────────────

export interface InsightNotification {
  insight_id: string
  tenant_id: string
  hypothesis: string          // human-readable name, e.g. "High Value Overdue"
  urgency: 'critical' | 'high' | 'medium' | 'low'
  or_score: number            // 0–1 deterministic confidence
  estimated_impact_low?: number   // minor units
  estimated_impact_high?: number  // minor units
  currency?: string           // e.g. "GBP"
  reasoning?: string          // LLM-generated explanation
  recommended_actions?: string[]
  action_url: string          // deep link back to Studio insight detail
  approve_url: string         // 1-click approve (token-signed)
  dismiss_url: string         // 1-click dismiss (token-signed)
  why_url?: string            // signed, no-login evidence explanation
}

export interface DeliveryResult {
  channel: 'whatsapp' | 'sms' | 'email' | 'slack' | 'teams' | 'web_push' | 'mobile_push'
  success: boolean
  external_id?: string        // Twilio SID or SendGrid message ID
  error?: string
  delivered_at: Date
}

class SlackChannel {
  async send(webhookUrl: string, notification: InsightNotification): Promise<DeliveryResult> {
    return sendWebhook('slack', webhookUrl, { text: buildSmsMessage(notification), blocks: [{ type: 'section', text: { type: 'mrkdwn', text: buildWhatsAppMessage(notification) } }] })
  }
}

class TeamsChannel {
  async send(webhookUrl: string, notification: InsightNotification): Promise<DeliveryResult> {
    return sendWebhook('teams', webhookUrl, { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: notification.hypothesis, weight: 'Bolder' }, { type: 'TextBlock', text: buildSmsMessage(notification), wrap: true }] } }] })
  }
}

export interface WebPushSender {
  send(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<void>
}

export class WebPushChannel {
  constructor(private readonly sender: WebPushSender) {}
  async send(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, notification: InsightNotification): Promise<DeliveryResult> {
    try {
      await this.sender.send(subscription, JSON.stringify({ title: notification.hypothesis, body: buildSmsMessage(notification), url: notification.action_url }))
      return { channel: 'web_push', success: true, delivered_at: new Date() }
    } catch (error) {
      return { channel: 'web_push', success: false, error: String(error), delivered_at: new Date() }
    }
  }
}

// ── Mobile push (Expo push service — apps/kairos-mobile) ───────────────────────
//
// Expo's push API takes an Expo push token directly (no per-tenant API key,
// unlike WebPush's VAPID keypair) — the token itself routes the notification
// to the right device via Expo's relay to APNs/FCM. See
// https://docs.expo.dev/push-notifications/sending-notifications/

export interface MobilePushSender {
  send(token: string, payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<{ id?: string }>
}

export class RealMobilePushSender implements MobilePushSender {
  async send(token: string, payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<{ id?: string }> {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: token,
        title: payload.title,
        body: payload.body,
        ...(payload.data ? { data: payload.data } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Expo push API returned ${res.status}`)
    const json = (await res.json()) as { data?: { status: string; id?: string; message?: string } }
    if (json.data?.status === 'error') throw new Error(json.data.message ?? 'Expo push API rejected the notification')
    return { id: json.data?.id }
  }
}

export class MobilePushChannel {
  constructor(private readonly sender: MobilePushSender) {}
  async send(token: string, notification: InsightNotification): Promise<DeliveryResult> {
    try {
      const result = await this.sender.send(token, {
        title: notification.hypothesis,
        body: buildSmsMessage(notification),
        data: { url: notification.action_url },
      })
      return { channel: 'mobile_push', success: true, ...(result.id ? { external_id: result.id } : {}), delivered_at: new Date() }
    } catch (error) {
      return { channel: 'mobile_push', success: false, error: String(error), delivered_at: new Date() }
    }
  }
}

async function sendWebhook(channel: 'slack' | 'teams', url: string, payload: Record<string, unknown>): Promise<DeliveryResult> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`${channel} webhook returned ${response.status}`)
    return { channel, success: true, delivered_at: new Date() }
  } catch (error) {
    return { channel, success: false, error: String(error), delivered_at: new Date() }
  }
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

const URGENCY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '🟢',
}

function fmtAmount(minor: number, currency = 'GBP'): string {
  const major = minor / 100
  // Use formatMoney's symbol map (supports GBP, USD, EUR, INR, etc.)
  const symbol = formatMoney(0, currency).charAt(0) || currency + ' '
  if (major >= 1000) return `${symbol}${(major / 1000).toFixed(1)}k`
  return `${symbol}${major.toFixed(0)}`
}

function impactRange(n: InsightNotification): string {
  if (!n.estimated_impact_low && !n.estimated_impact_high) return ''
  const low  = n.estimated_impact_low  ? fmtAmount(n.estimated_impact_low,  n.currency) : ''
  const high = n.estimated_impact_high ? fmtAmount(n.estimated_impact_high, n.currency) : ''
  if (low && high) return `${low}–${high}`
  return low || high
}

// ── WhatsApp message builder (Twilio Content Templates or freeform) ────────────

export function buildWhatsAppMessage(n: InsightNotification): string {
  const emoji = URGENCY_EMOJI[n.urgency] ?? '💡'
  const impact = impactRange(n)
  const confidence = Math.round(n.or_score * 100)

  const lines: string[] = [
    `${emoji} *${n.hypothesis}*`,
    `Confidence: ${confidence}% | ${n.urgency.toUpperCase()}`,
  ]

  if (impact) lines.push(`Estimated impact: *${impact}*`)
  if (n.reasoning) {
    // Strip unrendered template vars
    const clean = n.reasoning.replace(/\{\{[^}]+\}\}/g, '').trim()
    if (clean) lines.push(`\n_${clean.substring(0, 200)}${clean.length > 200 ? '…' : ''}_`)
  }

  if (n.recommended_actions?.length) {
    lines.push('\n*Recommended:*')
    n.recommended_actions.slice(0, 2).forEach((a, i) => lines.push(`${i + 1}. ${a}`))
  }

  lines.push(
    '',
    `✅ Approve: ${n.approve_url}`,
    `❌ Dismiss: ${n.dismiss_url}`,
    ...(n.why_url ? [`❓ Why?: ${n.why_url}`] : []),
    `🔍 Details: ${n.action_url}`,
  )

  return lines.join('\n')
}

// ── SMS message builder (160-char friendly) ────────────────────────────────────

export function buildSmsMessage(n: InsightNotification): string {
  const emoji = URGENCY_EMOJI[n.urgency] ?? '⚡'
  const impact = impactRange(n)
  const conf = Math.round(n.or_score * 100)
  const impact_str = impact ? ` (${impact})` : ''
  return `${emoji} Kairos: ${n.hypothesis}${impact_str} – ${conf}% confidence. Approve: ${n.approve_url} | Why: ${n.why_url ?? n.action_url}`
}

// ── HTML email builder ─────────────────────────────────────────────────────────

export function buildEmailHtml(n: InsightNotification): { subject: string; html: string; text: string } {
  const urgencyColor: Record<string, string> = {
    critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
  }
  const color = urgencyColor[n.urgency] ?? '#6366f1'
  const impact = impactRange(n)
  const conf = Math.round(n.or_score * 100)
  const clean_reasoning = n.reasoning?.replace(/\{\{[^}]+\}\}/g, '').trim() ?? ''

  const subject = `${URGENCY_EMOJI[n.urgency] ?? '⚡'} ${n.hypothesis} — ${conf}% confidence${impact ? ` · ${impact}` : ''}`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#fff;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#0c0c0e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden">
    <!-- Header -->
    <div style="background:#09090b;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#6366f1;text-transform:uppercase">Kairos Studio</div>
    </div>
    <!-- Urgency badge + title -->
    <div style="padding:24px 24px 0">
      <div style="display:inline-block;background:${color}20;border:1px solid ${color}40;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em">${n.urgency}</div>
      <h1 style="font-size:22px;font-weight:700;color:#fff;margin:12px 0 4px">${n.hypothesis}</h1>
      <div style="font-size:13px;color:#71717a">${conf}% confidence (rules engine)</div>
    </div>
    ${impact ? `
    <!-- Impact -->
    <div style="padding:16px 24px">
      <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:12px 16px">
        <div style="font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Estimated Impact</div>
        <div style="font-size:24px;font-weight:700;color:#a78bfa">${impact}</div>
      </div>
    </div>` : ''}
    ${clean_reasoning ? `
    <!-- Reasoning -->
    <div style="padding:0 24px 16px">
      <div style="font-size:13px;color:#a1a1aa;line-height:1.6">${clean_reasoning.substring(0, 400)}</div>
    </div>` : ''}
    ${n.recommended_actions?.length ? `
    <!-- Actions -->
    <div style="padding:0 24px 20px">
      <div style="font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Recommended Actions</div>
      ${n.recommended_actions.slice(0, 3).map((a, i) =>
        `<div style="display:flex;gap:8px;margin-bottom:6px"><span style="color:#6366f1;font-weight:700">${i + 1}.</span><span style="color:#e4e4e7;font-size:13px">${a}</span></div>`
      ).join('')}
    </div>` : ''}
    <!-- CTA buttons -->
    <div style="padding:20px 24px;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:12px;flex-wrap:wrap">
      <a href="${n.approve_url}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">✓ Approve</a>
      <a href="${n.dismiss_url}" style="display:inline-block;background:rgba(255,255,255,0.08);color:#a1a1aa;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">Dismiss</a>
      ${n.why_url ? `<a href="${n.why_url}" style="display:inline-block;background:rgba(99,102,241,0.15);color:#a78bfa;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">Why?</a>` : ''}
      <a href="${n.action_url}" style="display:inline-block;background:rgba(99,102,241,0.15);color:#a78bfa;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600">View Details →</a>
    </div>
    <!-- Footer -->
    <div style="padding:12px 24px;font-size:11px;color:#52525b">
      Kairos Studio · <a href="${n.action_url}" style="color:#6366f1;text-decoration:none">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`

  const text = `${n.hypothesis} (${n.urgency.toUpperCase()}, ${conf}% confidence)${impact ? `\nEstimated impact: ${impact}` : ''}${clean_reasoning ? `\n\n${clean_reasoning.substring(0, 300)}` : ''}\n\nApprove: ${n.approve_url}\nDismiss: ${n.dismiss_url}${n.why_url ? `\nWhy: ${n.why_url}` : ''}\nDetails: ${n.action_url}`

  return { subject, html, text }
}

// ── Channel implementations ────────────────────────────────────────────────────

export class WhatsAppChannel {
  private client: twilio.Twilio
  private from: string

  constructor() {
    const accountSid = process.env['TWILIO_ACCOUNT_SID'] ?? ''
    const authToken  = process.env['TWILIO_AUTH_TOKEN'] ?? ''
    this.from = `whatsapp:${process.env['TWILIO_WHATSAPP_FROM'] ?? '+14155238886'}`
    this.client = twilio(accountSid, authToken)
  }

  async send(to: string, notification: InsightNotification): Promise<DeliveryResult> {
    try {
      const body = buildWhatsAppMessage(notification)
      const msg = await this.client.messages.create({
        from: this.from,
        to: `whatsapp:${to}`,
        body,
      })
      return { channel: 'whatsapp', success: true, external_id: msg.sid, delivered_at: new Date() }
    } catch (err) {
      return { channel: 'whatsapp', success: false, error: String(err), delivered_at: new Date() }
    }
  }
}

export class SmsChannel {
  private client: twilio.Twilio
  private from: string

  constructor() {
    const accountSid = process.env['TWILIO_ACCOUNT_SID'] ?? ''
    const authToken  = process.env['TWILIO_AUTH_TOKEN'] ?? ''
    this.from = process.env['TWILIO_SMS_FROM'] ?? ''
    this.client = twilio(accountSid, authToken)
  }

  async send(to: string, notification: InsightNotification): Promise<DeliveryResult> {
    try {
      const body = buildSmsMessage(notification)
      const msg = await this.client.messages.create({ from: this.from, to, body })
      return { channel: 'sms', success: true, external_id: msg.sid, delivered_at: new Date() }
    } catch (err) {
      return { channel: 'sms', success: false, error: String(err), delivered_at: new Date() }
    }
  }
}

export class EmailChannel {
  constructor() {
    const apiKey = process.env['SENDGRID_API_KEY'] ?? ''
    if (apiKey) sgMail.setApiKey(apiKey)
  }

  async send(to: string, fromName: string, notification: InsightNotification): Promise<DeliveryResult> {
    try {
      const { subject, html, text } = buildEmailHtml(notification)
      const fromEmail = process.env['SENDGRID_FROM_EMAIL'] ?? 'insights@kairos.dev'
      await sgMail.send({
        to,
        from: { email: fromEmail, name: fromName || 'Kairos Studio' },
        subject,
        html,
        text,
      })
      return { channel: 'email', success: true, delivered_at: new Date() }
    } catch (err) {
      return { channel: 'email', success: false, error: String(err), delivered_at: new Date() }
    }
  }
}
