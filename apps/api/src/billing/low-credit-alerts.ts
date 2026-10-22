/**
 * Low-credit alerts — sends email notifications when tenants run low on
 * or run out of outcome credits, driving upgrade conversions.
 *
 * Triggers:
 *   - credits_balance drops to LOW_CREDIT_THRESHOLD (default 3): "running low" email
 *   - credits_balance drops to 0: "out of credits" email with upgrade CTA
 *
 * Alerts are deduplicated — a tenant only gets one "low" email and one "out"
 * email per billing cycle (tracked in billing.low_credit_alert_sent_at and
 * billing.zero_credit_alert_sent_at).
 */

import type { Db } from 'mongodb'
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import { EMAIL_COLORS, EMAIL_FONTS, appUrl, button, p, renderEmail } from '../email/layout.js'

const log = createLogger({ service: 'low-credit-alerts', version: '0.0.0' })

export const LOW_CREDIT_THRESHOLD = 3

export interface TenantForAlert {
  tenant_id: string
  contact_email?: string
  plan: string
  billing: {
    credits_balance: number
    credits_included: number
    currency: string
    low_credit_alert_sent_at?: Date
    zero_credit_alert_sent_at?: Date
    billing_period_start?: Date
  }
}

/**
 * Check a tenant's credit balance and send alerts if needed.
 * Called after every credit deduction (measureAndCharge) and after
 * the billing cron runs.
 */
export async function checkAndSendLowCreditAlert(
  db: Db,
  tenantId: string,
): Promise<{ alert_sent: 'low' | 'zero' | null }> {
  const tenants = getTenantCollection<Record<string, unknown>>(db, 'tenants', tenantId)
  const tenant = (await tenants.findOne()) as TenantForAlert | null
  if (!tenant) return { alert_sent: null }

  const balance = tenant.billing?.credits_balance ?? 0
  if (balance === Number.MAX_SAFE_INTEGER) return { alert_sent: null } // unlimited plan

  const now = new Date()
  const periodStart = tenant.billing?.billing_period_start ?? new Date(0)
  const email = tenant.contact_email

  // ── Zero credits alert ──────────────────────────────────────────────────────
  if (balance === 0) {
    const alreadySent = tenant.billing?.zero_credit_alert_sent_at
    if (alreadySent && new Date(alreadySent) > periodStart) {
      return { alert_sent: null } // Already sent this cycle
    }

    if (email) {
      await sendLowCreditEmail(email, 'zero', tenant).catch((err) => {
        log.error(
          { tenant_id: tenantId, err: String(err) },
          'Failed to send zero-credit alert email',
        )
      })
    }

    await tenants.updateOne({}, { $set: { 'billing.zero_credit_alert_sent_at': now } })

    log.info({ tenant_id: tenantId, balance, email: !!email }, 'Zero-credit alert sent')
    return { alert_sent: 'zero' }
  }

  // ── Low credits alert ───────────────────────────────────────────────────────
  if (balance <= LOW_CREDIT_THRESHOLD) {
    const alreadySent = tenant.billing?.low_credit_alert_sent_at
    if (alreadySent && new Date(alreadySent) > periodStart) {
      return { alert_sent: null } // Already sent this cycle
    }

    if (email) {
      await sendLowCreditEmail(email, 'low', tenant).catch((err) => {
        log.error(
          { tenant_id: tenantId, err: String(err) },
          'Failed to send low-credit alert email',
        )
      })
    }

    await tenants.updateOne({}, { $set: { 'billing.low_credit_alert_sent_at': now } })

    log.info({ tenant_id: tenantId, balance, email: !!email }, 'Low-credit alert sent')
    return { alert_sent: 'low' }
  }

  return { alert_sent: null }
}

export async function sendLowCreditEmail(
  to: string,
  type: 'low' | 'zero',
  tenant: TenantForAlert,
): Promise<void> {
  // Use the existing EmailChannel if available, otherwise log

  const upgradeUrl = `${appUrl()}/upgrade`

  const subject =
    type === 'zero'
      ? 'You\u2019re out of outcome credits'
      : `Running low on outcome credits \u2014 ${tenant.billing?.credits_balance} remaining`

  const heading =
    type === 'zero'
      ? 'You\u2019ve used all your outcome credits'
      : `You have ${tenant.billing?.credits_balance} outcome credits remaining`

  const bodyText =
    type === 'zero'
      ? 'Your outcome credits are at zero. This means LifeKeel will stop measuring and charging for verified outcomes \u2014 you\u2019ll miss out on attributed results until your credits refill or you upgrade.'
      : 'You\u2019re running low on outcome credits. When they run out, LifeKeel will stop measuring verified outcomes. Review your plan to see your available options.'

  const option = (title: string, blurb: string, link: { url: string; label: string }) =>
    `<div style="margin:0 0 14px;padding:16px 18px;background:${EMAIL_COLORS.page};border:1px solid ${EMAIL_COLORS.line};border-radius:12px;"><div style="font-size:16px;font-weight:600;margin:0 0 4px;">${title}</div><div style="font-size:14px;color:${EMAIL_COLORS.muted};margin:0 0 4px;">${blurb}</div>${button(link)}</div>`

  const html = renderEmail({
    preheader: heading,
    badge: { label: type === 'zero' ? 'Out of Credits' : 'Low Credits', tone: 'warning' },
    title: heading,
    bodyHtml:
      p(bodyText) +
      `<div style="margin:8px 0 10px;font-family:${EMAIL_FONTS.mono};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${EMAIL_COLORS.muted};">Your options</div>` +
      option('Upgrade your plan', 'Get more credits every month plus higher quotas.', {
        url: upgradeUrl,
        label: 'Upgrade \u2192',
      }),
    secondaryLinks: [{ url: upgradeUrl, label: 'Manage billing' }],
    footer: { reason: 'You got this because you manage billing for this LifeKeel account.' },
  })

  const text = `${heading}\n\n${bodyText}\n\nUpgrade: ${upgradeUrl}`

  // Use SendGrid directly (the EmailChannel expects InsightNotification, so we send raw)
  const sgMail = (await import('@sendgrid/mail')).default
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn(
      { tenant_id: tenant.tenant_id },
      'SENDGRID_API_KEY not set — skipping low-credit email',
    )
    return
  }
  sgMail.setApiKey(apiKey)
  const fromEmail = process.env['SENDGRID_FROM_EMAIL'] ?? 'insights@lifekeel.dev'
  await sgMail.send({
    to,
    from: { email: fromEmail, name: 'LifeKeel' },
    subject,
    html,
    text,
  })
}
