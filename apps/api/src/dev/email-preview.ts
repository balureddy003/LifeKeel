/**
 * Sends one of every outgoing email, filled with sample data, to the local
 * Mailpit inbox so the templates can be checked by eye:
 *   pnpm --filter @lifekeel/api email:preview   → http://localhost:8025
 * Refuses to run without MAILPIT_URL, so it can never reach real recipients.
 */
import { installMailpitTransport } from './mailpit.js'
import {
  sendContinuityAlertEmail,
  sendContinuityCheckInEmail,
  sendEmailVerificationEmail,
  sendFamilyInviteEmail,
  sendHeartbeatEmail,
  sendPasswordResetEmail,
} from '../auth-email.js'
import { sendVaultReminderEmail } from '../life-events/vault-reminder.js'
import { sendChecklistReminderEmail } from '../life-events/checklist-reminder.js'
import { EmailChannel } from '../delivery/channels.js'
import { sendLowCreditEmail, type TenantForAlert } from '../billing/low-credit-alerts.js'
import { renderHeartbeat } from '../feed/render-heartbeat.js'
import { renderQuietCareDigest } from '../feed/render-quiet-care.js'
import {
  activationBody,
  leadEducationBody,
  leadLastCallBody,
  leadWelcomeBody,
  sendEmail,
  trialEndingBody,
  trialExpiredBody,
  upgradeBody,
  winbackBody,
} from '../marketing/lifecycle-emails.js'
import { appUrl } from '../email/layout.js'

if (!installMailpitTransport()) {
  console.error('MAILPIT_URL is not set — refusing to send previews. See STARTER.md.')
  process.exit(1)
}

const to = 'preview@lifekeel.test'
const app = appUrl()
const unsub = `${app}/leads/unsubscribe?id=preview&sig=preview`
const tenant: TenantForAlert = {
  tenant_id: 'preview',
  plan: 'free',
  billing: { credits_balance: 3, credits_included: 25, currency: 'GBP' },
}

await sendEmailVerificationEmail(to, 'Sam Preview', `${app}/verify-email?token=preview`)
await sendPasswordResetEmail(to, 'Sam Preview', `${app}/reset-password/confirm?token=preview`)
await sendFamilyInviteEmail(to, 'Alex Preview', 'The Preview family', `${app}/invite?token=preview`)
await sendContinuityCheckInEmail(to, 'Sam Preview', 30, app)
await sendContinuityAlertEmail(to, 'Alex Preview', 'Sam', 37, app)
await sendVaultReminderEmail(to, 'Alex Preview', 'Sam', 'A bereavement in the family', 4)
await sendChecklistReminderEmail(to, 'Sam Preview', 'Job loss', 3)

await sendHeartbeatEmail(
  to,
  'Sam Preview',
  renderHeartbeat({
    period: 'week',
    window_start: new Date(Date.now() - 7 * 86_400_000),
    score_delta: 4,
    moved_events: 3,
    open_insights: 2,
    new_insights: 1,
    resolved_insights: 1,
    renewals: [{ type: 'home', renewal_date: '2026-11-18' }],
    pending_steps: 2,
    profile_stale: false,
    review_due: false,
    app_url: app,
  }),
  `${app}/heartbeat/unsubscribe?preview=1`,
)
await sendHeartbeatEmail(
  to,
  'Sam Preview',
  renderQuietCareDigest({
    period_label: 'September 2026',
    range_label: '1–30 September',
    check: { status: 'ran', last_check: new Date() },
    score: 72,
    score_delta: 2,
    moved_events: 1,
    new_insights: 1,
    resolved_insights: 0,
    renewals: [{ type: 'car', renewal_date: '2026-10-30' }],
    worth_a_look: {
      text: 'Life cover is on file for one adult but not the other.',
      href: `${app}/insights/preview`,
    },
    paused: [],
    next_check: new Date(Date.now() + 86_400_000),
    app_url: app,
  }),
  `${app}/heartbeat/unsubscribe?preview=1`,
)

await new EmailChannel().send(to, 'LifeKeel', {
  insight_id: 'preview',
  tenant_id: 'preview',
  hypothesis: 'Emergency buffer below three months',
  urgency: 'high',
  or_score: 0.86,
  estimated_impact_low: 450_000,
  estimated_impact_high: 900_000,
  currency: 'GBP',
  reasoning: 'Savings on file cover about 2.1 months of the expenses you entered.',
  recommended_actions: ['Check the savings figure is current', 'Talk to a licensed professional'],
  action_url: `${app}/insights/preview`,
  approve_url: `${app}/insights/preview?approve=1`,
  dismiss_url: `${app}/insights/preview?dismiss=1`,
  why_url: `${app}/insights/preview/why`,
})

await sendLowCreditEmail(to, 'low', tenant)
await sendLowCreditEmail(to, 'zero', tenant)

const lifecycle: [string, string][] = [
  ['Welcome to LifeKeel', leadWelcomeBody('Sam', app, unsub)],
  ['Three things families often find out late', leadEducationBody('Sam', app, unsub)],
  ['Still here when you’re ready', leadLastCallBody('Sam', app, unsub)],
  ['One step left — your family profile', activationBody('Sam', app)],
  ['What Keel Plus adds', upgradeBody('Sam', app)],
  [
    'Your LifeKeel trial ends soon',
    trialEndingBody('Sam', new Date(Date.now() + 3 * 86_400_000), app),
  ],
  ['Your trial has ended — AI is paused', trialExpiredBody('Sam', app)],
  ['Your Keel data is still here', winbackBody('Sam', app)],
]
for (const [subject, html] of lifecycle) await sendEmail(to, subject, html)

console.log(
  `Sent ${12 + lifecycle.length} preview emails to Mailpit (${process.env['MAILPIT_URL']})`,
)
