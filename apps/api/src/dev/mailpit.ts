/**
 * Local-only email capture. When MAILPIT_URL is set, every `sgMail.send`
 * in the API is delivered to a local Mailpit inbox (compose.local.yml)
 * through its HTTP send API instead of SendGrid, so no sender needs to change.
 *
 * Senders still skip when SENDGRID_API_KEY is unset, so local .env pairs this
 * with a placeholder key (see STARTER.md). Refuses to start in production or
 * against a non-loopback host: family email content must not leave the machine.
 */

import sgMail, { type MailDataRequired } from '@sendgrid/mail'
import { createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'mailpit-dev', version: '0.0.0' })

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

type EmailData = string | { name?: string; email: string }

interface MailpitAddress {
  Email: string
  Name?: string
}

export interface MailpitMessage {
  From: MailpitAddress
  To: MailpitAddress[]
  Cc?: MailpitAddress[]
  Bcc?: MailpitAddress[]
  ReplyTo?: MailpitAddress[]
  Subject: string
  Text?: string
  HTML?: string
  Headers?: Record<string, string>
}

export function resolveMailpitUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env['MAILPIT_URL']?.trim()
  if (!raw) return null
  if (env['NODE_ENV'] === 'production') {
    throw new Error('MAILPIT_URL is a local-development setting and must not be set in production')
  }
  const url = new URL(raw)
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`MAILPIT_URL must point at localhost, got "${url.hostname}"`)
  }
  return url.origin
}

function toAddress(data: EmailData): MailpitAddress {
  return typeof data === 'string' ? { Email: data } : { Email: data.email, Name: data.name }
}

function toAddresses(data: EmailData | EmailData[] | undefined): MailpitAddress[] | undefined {
  if (!data) return undefined
  return (Array.isArray(data) ? data : [data]).map(toAddress)
}

export function toMailpitMessage(data: MailDataRequired): MailpitMessage {
  return {
    From: toAddress(data.from),
    To: toAddresses(data.to) ?? [],
    Cc: toAddresses(data.cc),
    Bcc: toAddresses(data.bcc),
    ReplyTo: toAddresses(data.replyTo),
    Subject: data.subject ?? '',
    Text: data.text,
    HTML: data.html,
    Headers: data.headers,
  }
}

export function installMailpitTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  const baseUrl = resolveMailpitUrl(env)
  if (!baseUrl) return false

  const send: typeof sgMail.send = async (data) => {
    for (const message of Array.isArray(data) ? data : [data]) {
      const res = await fetch(`${baseUrl}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toMailpitMessage(message)),
      })
      if (!res.ok) throw new Error(`Mailpit send failed: ${res.status} ${await res.text()}`)
    }
    return [{ statusCode: 202, body: {}, headers: {} }, {}]
  }
  sgMail.send = send

  log.info({ inbox: baseUrl }, 'Mailpit dev transport enabled — outgoing email is captured locally')
  return true
}
