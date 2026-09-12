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
import { createLogger, getTenantCollection } from '@kairos/platform'

const log = createLogger({ service: 'low-credit-alerts', version: '0.0.0' })

export const LOW_CREDIT_THRESHOLD = 3

interface TenantForAlert {
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
      await sendEmail(db, email, 'zero', tenant).catch(err => {
        log.error({ tenant_id: tenantId, err: String(err) }, 'Failed to send zero-credit alert email')
      })
    }

    await tenants.updateOne(
      {},
      { $set: { 'billing.zero_credit_alert_sent_at': now } },
    )

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
      await sendEmail(db, email, 'low', tenant).catch(err => {
        log.error({ tenant_id: tenantId, err: String(err) }, 'Failed to send low-credit alert email')
      })
    }

    await tenants.updateOne(
      {},
      { $set: { 'billing.low_credit_alert_sent_at': now } },
    )

    log.info({ tenant_id: tenantId, balance, email: !!email }, 'Low-credit alert sent')
    return { alert_sent: 'low' }
  }

  return { alert_sent: null }
}

async function sendEmail(_db: Db, to: string, type: 'low' | 'zero', tenant: TenantForAlert): Promise<void> {
  // Use the existing EmailChannel if available, otherwise log

  const studioUrl = process.env['STUDIO_URL'] ?? 'https://studio.kairos.dev'
  const upgradeUrl = `${studioUrl}/settings/billing?upgrade=true`
  const creditsUrl = `${studioUrl}/settings/billing?buy_credits=true`

  const subject = type === 'zero'
    ? 'You\u2019re out of outcome credits \u2014 upgrade to keep getting insights'
    : `Running low on outcome credits \u2014 ${tenant.billing?.credits_balance} remaining`

  const heading = type === 'zero'
    ? 'You\u2019ve used all your outcome credits'
    : `You have ${tenant.billing?.credits_balance} outcome credits remaining`

  const bodyText = type === 'zero'
    ? 'Your outcome credits are at zero. This means Kairos will stop measuring and charging for verified outcomes \u2014 you\u2019ll miss out on attributed results until your credits refill or you upgrade.'
    : 'You\u2019re running low on outcome credits. When they run out, Kairos will stop measuring verified outcomes. Upgrade your plan or buy a credit pack to keep getting attributed results.'

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#fff;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#0c0c0e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden">
    <div style="background:#09090b;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#6366f1;text-transform:uppercase">Kairos Studio</div>
    </div>
    <div style="padding:24px">
      <div style="display:inline-block;background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.4);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#eab308;text-transform:uppercase;letter-spacing:0.05em">${type === 'zero' ? 'Out of Credits' : 'Low Credits'}</div>
      <h1 style="font-size:22px;font-weight:700;color:#fff;margin:12px 0 8px">${heading}</h1>
      <p style="font-size:14px;color:#a1a1aa;line-height:1.6">${bodyText}</p>
    </div>
    <div style="padding:0 24px 8px">
      <div style="font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Your options</div>
      <div style="margin-bottom:12px;padding:12px 16px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px">
        <div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:4px">Upgrade your plan</div>
        <div style="font-size:13px;color:#a1a1aa">Get more credits every month plus higher quotas.</div>
        <a href="${upgradeUrl}" style="display:inline-block;margin-top:8px;background:#6366f1;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600">Upgrade \u2192</a>
      </div>
      <div style="margin-bottom:12px;padding:12px 16px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px">
        <div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:4px">Buy a credit pack</div>
        <div style="font-size:13px;color:#a1a1aa">One-time purchase \u2014 25, 50, 100 or 250 credits. No plan change needed.</div>
        <a href="${creditsUrl}" style="display:inline-block;margin-top:8px;background:#22c55e;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600">Buy Credits \u2192</a>
      </div>
    </div>
    <div style="padding:12px 24px;font-size:11px;color:#52525b;border-top:1px solid rgba(255,255,255,0.06)">
      Kairos Studio \u00b7 <a href="${studioUrl}/settings/billing" style="color:#6366f1;text-decoration:none">Manage billing</a>
    </div>
  </div>
</body>
</html>`

  const text = `${heading}\n\n${bodyText}\n\nUpgrade: ${upgradeUrl}\nBuy credits: ${creditsUrl}`

  // Use SendGrid directly (the EmailChannel expects InsightNotification, so we send raw)
  const sgMail = (await import('@sendgrid/mail')).default
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ tenant_id: tenant.tenant_id }, 'SENDGRID_API_KEY not set — skipping low-credit email')
    return
  }
  sgMail.setApiKey(apiKey)
  const fromEmail = process.env['SENDGRID_FROM_EMAIL'] ?? 'insights@kairos.dev'
  await sgMail.send({
    to,
    from: { email: fromEmail, name: 'Kairos Studio' },
    subject,
    html,
    text,
  })
}
