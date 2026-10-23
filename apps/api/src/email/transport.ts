/**
 * Outbound email transport — SendGrid by default, Resend when configured.
 *
 * SendGrid remains the implicit transport: every sender in the API calls
 * `sgMail.send` against `@sendgrid/mail`. Setting RESEND_API_KEY instead
 * installs a fetch-based transport onto `sgMail.send` — the same seam
 * dev/mailpit.ts uses for local capture — so no sender needs provider-
 * specific code. Mailpit still wins when MAILPIT_URL is set (server.ts
 * installs it first).
 *
 * Provider selection: RESEND_API_KEY > SENDGRID_API_KEY. Setting both is
 * unusual and means Resend — RESEND_API_KEY is the deliberate switch.
 *
 * Field mapping: SendGrid's MailDataRequired carries `customArgs`; Resend
 * echoes those back through `tags` on its event webhook — lifecycle mail's
 * `lk` ledger key rides the same field either way (webhooks-resend.ts).
 * `trackingSettings` is SendGrid-only and is dropped; Resend's open/click
 * tracking is a dashboard toggle, not per-send.
 */

import sgMail, { type MailDataRequired } from '@sendgrid/mail'
import { createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'email-transport', version: '0.0.0' })

export type EmailProvider = 'sendgrid' | 'resend'

/** Which provider outbound mail will go through, given the env. */
export function activeEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider | null {
  if (env['RESEND_API_KEY']?.trim()) return 'resend'
  if (env['SENDGRID_API_KEY']?.trim()) return 'sendgrid'
  return null
}

/** Gate check senders use instead of reading SENDGRID_API_KEY directly —
 *  Resend counts as configured too. */
export function emailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return activeEmailProvider(env) !== null
}

/** Sender address. EMAIL_FROM is provider-neutral; SENDGRID_FROM_EMAIL is
 *  the pre-Resend name and stays as the fallback so existing deploys keep
 *  working. Empty strings count as unset — deploy templates can render an
 *  unset repo variable as `EMAIL_FROM=` rather than dropping the var. */
export function emailFromAddress(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['EMAIL_FROM']?.trim() || env['SENDGRID_FROM_EMAIL']?.trim() || undefined
}

// ── Resend message mapping ─────────────────────────────────────────────────

type EmailData = string | { name?: string; email: string }

export interface ResendMessage {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  reply_to?: string[]
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
  tags?: { name: string; value: string }[]
  attachments?: { filename?: string; content?: string; content_type?: string }[]
}

function formatAddress(data: EmailData): string {
  if (typeof data === 'string') return data
  return data.name ? `${data.name} <${data.email}>` : data.email
}

function formatAddresses(data: EmailData | EmailData[] | undefined): string[] | undefined {
  if (!data) return undefined
  return (Array.isArray(data) ? data : [data]).map(formatAddress)
}

export function toResendMessage(data: MailDataRequired): ResendMessage {
  const tags = data.customArgs
    ? Object.entries(data.customArgs).map(([name, value]) => ({ name, value }))
    : undefined
  const attachments = data.attachments?.map((a) => ({
    filename: a.filename,
    content: a.content,
    content_type: a.type,
  }))
  return {
    from: formatAddress(data.from),
    to: formatAddresses(data.to) ?? [],
    cc: formatAddresses(data.cc),
    bcc: formatAddresses(data.bcc),
    reply_to: formatAddresses(data.replyTo),
    subject: data.subject ?? '',
    text: data.text,
    html: data.html,
    headers: data.headers,
    ...(tags?.length ? { tags } : {}),
    ...(attachments?.length ? { attachments } : {}),
  }
}

const RESEND_API_BASE = 'https://api.resend.com'

/**
 * Replaces `sgMail.send` with a Resend REST call when RESEND_API_KEY is set.
 * Returns false (leaving SendGrid untouched) when the key is absent.
 * RESEND_API_BASE overrides the API origin — test/self-host hook.
 */
export function installResendTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  const apiKey = env['RESEND_API_KEY']?.trim()
  if (!apiKey) return false
  const baseUrl = env['RESEND_API_BASE']?.trim() || RESEND_API_BASE

  const send: typeof sgMail.send = async (data) => {
    for (const message of Array.isArray(data) ? data : [data]) {
      const res = await fetch(`${baseUrl}/emails`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(toResendMessage(message)),
        signal: AbortSignal.timeout(10_000),
      })
      // Attach the HTTP status as `code` — sendOtpEmail classifies 4xx as a
      // definite rejection ('failed') vs a retryable 'unknown', matching the
      // shape SendGrid errors carry.
      if (!res.ok)
        throw Object.assign(
          new Error(`Resend send failed: ${res.status} ${await res.text()}`),
          { code: res.status },
        )
    }
    return [{ statusCode: 202, body: {}, headers: {} }, {}]
  }
  sgMail.send = send

  log.info({}, 'Resend email transport enabled — outbound mail goes to Resend, not SendGrid')
  return true
}
