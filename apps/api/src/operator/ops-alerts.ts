/**
 * Generic operational alerting — sends critical errors to Slack.
 *
 * Reuses the same Slack bot token as billing alerts but posts to a
 * separate ops channel (configurable via LIFEKEEL_OPS_ALERT_CHANNEL).
 * Falls back to the billing alert channel if not set.
 *
 * Never throws — alert failures are logged but never interrupt the caller.
 */

import { createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'ops-alerts', version: '0.0.0' })

// Rate limit: max 1 alert per minute per error fingerprint to prevent alert storms
const recentAlerts = new Map<string, number>()
const ALERT_COOLDOWN_MS = 60_000

export interface OpsAlertOpts {
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  fingerprint?: string // dedup key — if same fingerprint alerted recently, skip
  tenant_id?: string
}

/**
 * Send an operational alert to Slack (if configured).
 * Rate-limited per fingerprint to prevent alert storms.
 */
export async function sendOpsAlert(opts: OpsAlertOpts): Promise<void> {
  const { title, message, severity, fingerprint, tenant_id } = opts

  // Always emit a structured log line
  log.warn({ alert: title, severity, tenant_id, message }, `Ops alert: ${title}`)

  // Rate limit by fingerprint
  const dedupKey = fingerprint ?? `${title}:${severity}`
  const now = Date.now()
  const lastAlerted = recentAlerts.get(dedupKey) ?? 0
  if (now - lastAlerted < ALERT_COOLDOWN_MS) return
  recentAlerts.set(dedupKey, now)

  const token = process.env['LIFEKEEL_SLACK_BOT_TOKEN']
  const channel =
    process.env['LIFEKEEL_OPS_ALERT_CHANNEL'] ??
    process.env['LIFEKEEL_BILLING_ALERT_CHANNEL'] ??
    '#alerts'

  if (!token) return // Slack not configured — alert already logged

  const emoji =
    severity === 'critical'
      ? ':rotating_light:'
      : severity === 'warning'
        ? ':warning:'
        : ':information_source:'
  const text = `${emoji} *[${severity.toUpperCase()}] ${title}*\n${message}${tenant_id ? `\n_Tenant: ${tenant_id}_` : ''}`

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text, mrkdwn: true }),
    })
    if (!res.ok) {
      log.error({ status: res.status }, 'Ops Slack alert HTTP error')
    }
  } catch (err) {
    log.error({ err }, 'Ops Slack alert failed')
  }
}
