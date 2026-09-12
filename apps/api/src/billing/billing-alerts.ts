/**
 * Billing alerts — sends notifications to Slack when billing-related errors occur.
 *
 * Covers:
 * - Payment failure spikes (invoice.payment_failed webhook)
 * - Reconciliation discrepancies (credit ledger mismatch)
 * - Cron job failures (settlement / reconciliation errors)
 *
 * Uses the Slack Web API (chat.postMessage) with a bot token. If no token is
 * configured, alerts are only logged via pino.
 */

import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'billing-alerts', version: '0.0.0' })

export interface BillingAlertOpts {
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  tenant_id?: string
}

const SEVERITY_EMOJI: Record<BillingAlertOpts['severity'], string> = {
  info: ':information_source:',
  warning: ':warning:',
  critical: ':rotating_light:',
}

/**
 * Send a billing alert to Slack (if configured) and always emit a structured
 * pino log line. Never throws — alert failures are logged but do not interrupt
 * the caller's flow.
 */
export async function sendBillingAlert(opts: BillingAlertOpts): Promise<void> {
  const { title, message, severity, tenant_id } = opts

  // Always emit a structured pino log line for every alert.
  log.warn(
    {
      alert: title,
      severity,
      tenant_id,
      message,
    },
    `Billing alert: ${title}`,
  )

  const token = process.env['KAIROS_SLACK_BOT_TOKEN']
  const channel = process.env['KAIROS_BILLING_ALERT_CHANNEL'] ?? '#alerts'

  if (!token) {
    // No Slack token configured — alert already logged above.
    return
  }

  const text = `${SEVERITY_EMOJI[severity]} *[${severity.toUpperCase()}] ${title}*\n${message}${tenant_id ? `\n_Tenant: ${tenant_id}_` : ''}`

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel,
        text,
        mrkdwn: true,
      }),
    })

    if (!res.ok) {
      log.error(
        {
          status: res.status,
          status_text: res.statusText,
          alert: title,
          severity,
        },
        'Slack chat.postMessage returned non-OK HTTP status',
      )
      return
    }

    const body = (await res.json()) as { ok?: boolean; error?: string }
    if (!body.ok) {
      log.error(
        {
          slack_error: body.error,
          alert: title,
          severity,
        },
        'Slack chat.postMessage API call failed',
      )
    }
  } catch (err) {
    log.error(
      {
        err: String(err),
        alert: title,
        severity,
      },
      'Failed to send billing alert to Slack',
    )
  }
}
