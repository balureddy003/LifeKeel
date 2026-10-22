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
import { formatMoney } from '@lifekeel/platform'
import { buildAlertPushPayload } from './push-payload.js'
import {
  EMAIL_COLORS,
  EMAIL_FONTS,
  appUrl,
  escapeHtml,
  muted,
  p,
  renderEmail,
  type EmailTone,
} from '../email/layout.js'

// ── Shared types ───────────────────────────────────────────────────────────────

export interface InsightNotification {
  insight_id: string
  tenant_id: string
  hypothesis: string // human-readable name, e.g. "High Value Overdue"
  urgency: 'critical' | 'high' | 'medium' | 'low'
  or_score: number // 0–1 deterministic confidence
  estimated_impact_low?: number // minor units
  estimated_impact_high?: number // minor units
  currency?: string // e.g. "GBP"
  reasoning?: string // LLM-generated explanation
  recommended_actions?: string[]
  action_url: string // deep link back to Studio insight detail
  approve_url: string // 1-click approve (token-signed)
  dismiss_url: string // 1-click dismiss (token-signed)
  why_url?: string // signed, no-login evidence explanation
}

export interface DeliveryResult {
  channel: 'whatsapp' | 'sms' | 'email' | 'slack' | 'teams' | 'web_push' | 'mobile_push'
  success: boolean
  external_id?: string // Twilio SID or SendGrid message ID
  error?: string
  /** PRD-140: the device is gone or revoked (expired subscription, unregistered
   *  token). The router removes it and records the failure instead of retrying. */
  permanent?: boolean
  delivered_at: Date
}

/** Thrown by a push sender when the device will never accept another message. */
export class PermanentPushFailure extends Error {}

const isPermanentWebPush = (e: unknown) => {
  const status = (e as { statusCode?: number } | null)?.statusCode
  return status === 404 || status === 410
}

class SlackChannel {
  async send(webhookUrl: string, notification: InsightNotification): Promise<DeliveryResult> {
    return sendWebhook('slack', webhookUrl, {
      text: buildSmsMessage(notification),
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: buildWhatsAppMessage(notification) } },
      ],
    })
  }
}

class TeamsChannel {
  async send(webhookUrl: string, notification: InsightNotification): Promise<DeliveryResult> {
    return sendWebhook('teams', webhookUrl, {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: notification.hypothesis, weight: 'Bolder' },
              { type: 'TextBlock', text: buildSmsMessage(notification), wrap: true },
            ],
          },
        },
      ],
    })
  }
}

export interface WebPushSender {
  send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ): Promise<void>
}

export class WebPushChannel {
  constructor(private readonly sender: WebPushSender) {}
  async send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    notification: InsightNotification,
  ): Promise<DeliveryResult> {
    try {
      // Generic payload only (PRD-140): a push shows on lock screens.
      await this.sender.send(subscription, JSON.stringify(buildAlertPushPayload(notification)))
      return { channel: 'web_push', success: true, delivered_at: new Date() }
    } catch (error) {
      return {
        channel: 'web_push',
        success: false,
        error: String(error),
        ...(isPermanentWebPush(error) ? { permanent: true } : {}),
        delivered_at: new Date(),
      }
    }
  }
}

// ── Mobile push (Expo push service — apps/lifekeel-mobile) ───────────────────────
//
// Expo's push API takes an Expo push token directly (no per-tenant API key,
// unlike WebPush's VAPID keypair) — the token itself routes the notification
// to the right device via Expo's relay to APNs/FCM. See
// https://docs.expo.dev/push-notifications/sending-notifications/

export interface MobilePushPayload {
  title: string
  body: string
  data?: Record<string, unknown>
}

export interface MobilePushSender {
  send(token: string, payload: MobilePushPayload): Promise<{ id?: string }>
}

export class RealMobilePushSender implements MobilePushSender {
  async send(
    token: string,
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<{ id?: string }> {
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
    if (json.data?.status === 'error') {
      const detail = (json.data as { details?: { error?: string } }).details?.error
      if (detail === 'DeviceNotRegistered')
        throw new PermanentPushFailure('Expo token no longer registered')
      throw new Error(json.data.message ?? 'Expo push API rejected the notification')
    }
    return { id: json.data?.id }
  }
}

export class MobilePushChannel {
  constructor(private readonly sender: MobilePushSender) {}
  async send(token: string, notification: InsightNotification): Promise<DeliveryResult> {
    try {
      const generic = buildAlertPushPayload(notification)
      const result = await this.sender.send(token, {
        title: generic.title,
        body: generic.body,
        data: { url: generic.url },
      })
      return {
        channel: 'mobile_push',
        success: true,
        ...(result.id ? { external_id: result.id } : {}),
        delivered_at: new Date(),
      }
    } catch (error) {
      return {
        channel: 'mobile_push',
        success: false,
        error: String(error),
        ...(error instanceof PermanentPushFailure ? { permanent: true } : {}),
        delivered_at: new Date(),
      }
    }
  }
}

async function sendWebhook(
  channel: 'slack' | 'teams',
  url: string,
  payload: Record<string, unknown>,
): Promise<DeliveryResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`${channel} webhook returned ${response.status}`)
    return { channel, success: true, delivered_at: new Date() }
  } catch (error) {
    return { channel, success: false, error: String(error), delivered_at: new Date() }
  }
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

const URGENCY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
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
  const low = n.estimated_impact_low ? fmtAmount(n.estimated_impact_low, n.currency) : ''
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
  return `${emoji} LifeKeel: ${n.hypothesis}${impact_str} – ${conf}% confidence. Approve: ${n.approve_url} | Why: ${n.why_url ?? n.action_url}`
}

// ── HTML email builder ─────────────────────────────────────────────────────────

export function buildEmailHtml(n: InsightNotification): {
  subject: string
  html: string
  text: string
} {
  const urgencyTone: Record<InsightNotification['urgency'], EmailTone> = {
    critical: 'danger',
    high: 'danger',
    medium: 'warning',
    low: 'success',
  }
  const impact = impactRange(n)
  const conf = Math.round(n.or_score * 100)
  const clean_reasoning = n.reasoning?.replace(/\{\{[^}]+\}\}/g, '').trim() ?? ''

  const subject = `${URGENCY_EMOJI[n.urgency] ?? '⚡'} ${n.hypothesis} — ${conf}% confidence${impact ? ` · ${impact}` : ''}`

  const label = (text: string) =>
    `<div style="margin:0 0 6px;font-family:${EMAIL_FONTS.mono};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${EMAIL_COLORS.muted};">${text}</div>`
  const impactHtml = impact
    ? `<div style="margin:0 0 20px;padding:14px 18px;background:${EMAIL_COLORS.page};border:1px solid ${EMAIL_COLORS.line};border-radius:12px;">${label('Estimated Impact')}<div style="font-family:${EMAIL_FONTS.display};font-size:28px;line-height:1.1;color:${EMAIL_COLORS.ink};">${escapeHtml(impact)}</div></div>`
    : ''
  const reasoningHtml = clean_reasoning ? p(escapeHtml(clean_reasoning.substring(0, 400))) : ''
  const actionsHtml = n.recommended_actions?.length
    ? `${label('Recommended Actions')}<ol style="margin:0 0 16px;padding-left:20px;">${n.recommended_actions
        .slice(0, 3)
        .map((a) => `<li style="margin:0 0 6px;">${escapeHtml(a)}</li>`)
        .join('')}</ol>`
    : ''

  const html = renderEmail({
    preheader: `${conf}% confidence${impact ? ` · ${impact}` : ''}`,
    badge: { label: n.urgency, tone: urgencyTone[n.urgency] ?? 'info' },
    title: n.hypothesis,
    bodyHtml:
      muted(`${conf}% confidence (rules engine)`) + impactHtml + reasoningHtml + actionsHtml,
    cta: { url: n.approve_url, label: '✓ Approve' },
    secondaryLinks: [
      { url: n.dismiss_url, label: 'Dismiss' },
      ...(n.why_url ? [{ url: n.why_url, label: 'Why?' }] : []),
      { url: n.action_url, label: 'View Details →' },
    ],
    footer: {
      reason: 'You got this because email alerts are on for your family on LifeKeel.',
      manageUrl: `${appUrl()}/settings#notifications`,
    },
  })

  const text = `${n.hypothesis} (${n.urgency.toUpperCase()}, ${conf}% confidence)${impact ? `\nEstimated impact: ${impact}` : ''}${clean_reasoning ? `\n\n${clean_reasoning.substring(0, 300)}` : ''}\n\nApprove: ${n.approve_url}\nDismiss: ${n.dismiss_url}${n.why_url ? `\nWhy: ${n.why_url}` : ''}\nDetails: ${n.action_url}`

  return { subject, html, text }
}

// ── Channel implementations ────────────────────────────────────────────────────

export class WhatsAppChannel {
  private client: twilio.Twilio
  private from: string

  constructor() {
    const accountSid = process.env['TWILIO_ACCOUNT_SID'] ?? ''
    const authToken = process.env['TWILIO_AUTH_TOKEN'] ?? ''
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
    const authToken = process.env['TWILIO_AUTH_TOKEN'] ?? ''
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

  async send(
    to: string,
    fromName: string,
    notification: InsightNotification,
  ): Promise<DeliveryResult> {
    try {
      const { subject, html, text } = buildEmailHtml(notification)
      const fromEmail = process.env['SENDGRID_FROM_EMAIL'] ?? 'insights@lifekeel.dev'
      await sgMail.send({
        to,
        from: { email: fromEmail, name: fromName || 'LifeKeel' },
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
