/**
 * Transactional auth email — password reset.
 *
 * Separate from delivery/channels.ts's EmailChannel, which is tightly
 * coupled to insight-notification copy (buildEmailHtml(InsightNotification)).
 * This is generic account mail, sent through whichever provider
 * email/transport.ts selects (SendGrid or Resend) but with its own templates.
 *
 * Gracefully no-ops when no email provider is configured — matching the
 * OCR extraction pattern (apps/api/src/ocr/extract.ts): the request still
 * succeeds, a warning is logged, and nothing crashes for users running
 * without an email provider configured.
 */

import sgMail from '@sendgrid/mail'
import { createLogger } from '@lifekeel/platform'
import { emailConfigured, emailFromAddress } from './email/transport.js'
import { EMAIL_COLORS, EMAIL_FONTS, escapeHtml, p, renderEmail } from './email/layout.js'

const log = createLogger({ service: 'auth-email', version: '0.0.0' })

function getFromEmail(): string {
  return emailFromAddress() ?? 'accounts@lifekeel.co.uk'
}

// Sent on signup, email change, and resend-verification. The token-bearing
// URL is how the recipient proves mailbox ownership, so it never lands in
// logs — only `to` is logged, matching every helper in this file.
export async function sendEmailVerificationEmail(
  to: string,
  name: string,
  verifyUrl: string,
): Promise<void> {
  if (!emailConfigured()) {
    log.warn({ to }, 'No email provider configured — skipping email verification email')
    return
  }

  const apiKey = process.env['SENDGRID_API_KEY']
  if (apiKey) sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'LifeKeel' },
      subject: 'Verify your email',
      text: `Hi ${firstName},\n\nPlease verify this email address for your LifeKeel account (link expires in 24 hours):\n${verifyUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: renderEmail({
        preheader: 'Confirm this address for your LifeKeel account. The link expires in 24 hours.',
        eyebrow: 'Your account',
        title: 'Verify your email',
        bodyHtml:
          p(`Hi ${escapeHtml(firstName)},`) +
          p(
            'Please verify this email address for your LifeKeel account. This link expires in 24 hours.',
          ),
        cta: { url: verifyUrl, label: 'Verify email' },
        note: "If you didn't request this, you can safely ignore this email.",
        footer: { reason: 'You got this because this address was used for a LifeKeel account.' },
      }),
    })
    log.info({ to }, 'Email verification sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send email verification')
  }
}

// ── Email one-time code (CLOUDFLARE_INTEGRATION.md §6.8) ────────────────────

export type OtpDelivery = 'sent' | 'failed' | 'unknown'
export type OtpPurpose = 'signup' | 'login'

const OTP_SEND_TIMEOUT_MS = 5000

/** The code, large and monospaced, built from the same table primitives as button(). */
function codeBlock(spaced: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 16px;">
  <tr><td align="center" bgcolor="${EMAIL_COLORS.page}" style="background:${EMAIL_COLORS.page};border:1px solid ${EMAIL_COLORS.line};border-radius:12px;padding:18px 12px;">
    <span style="font-family:${EMAIL_FONTS.mono};font-size:32px;font-weight:600;letter-spacing:6px;color:${EMAIL_COLORS.ink};">${escapeHtml(spaced)}</span>
  </td></tr>
</table>`
}

export function otpEmailContent(name: string, code: string, purpose: OtpPurpose) {
  const firstName = name.split(' ')[0] || 'there'
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
  const action = purpose === 'signup' ? 'confirm your email address' : 'sign in'
  const subject =
    purpose === 'signup' ? `Confirm your email: ${spaced}` : `Your LifeKeel code: ${spaced}`
  const text = [
    `Hi ${firstName},`,
    '',
    `Your LifeKeel ${purpose === 'signup' ? 'confirmation' : 'sign-in'} code is:`,
    '',
    `    ${spaced}`,
    '',
    'It expires in 10 minutes. Enter it on the LifeKeel page you just used.',
    '',
    'LifeKeel will never ask you for this code by phone, chat or email.',
    `If you didn't try to ${purpose === 'signup' ? 'create an account' : 'sign in'}, ignore this message. Your account is safe, and no one can sign in without this code. If you keep getting these, change your password.`,
  ].join('\n')
  const html = renderEmail({
    preheader: `Your code is ${spaced}. It expires in 10 minutes.`,
    eyebrow: purpose === 'signup' ? 'Confirm your email' : 'Sign in',
    title: 'Your one-time code',
    bodyHtml:
      p(`Hi ${escapeHtml(firstName)},`) +
      p(`Use this code to ${action}:`) +
      codeBlock(spaced) +
      p('This code expires in <strong>10 minutes</strong> and works once.'),
    note: "LifeKeel will never ask you for this code by phone, chat or email. If you didn't request it, you can ignore this message. No one can sign in without it.",
    footer: { reason: 'You got this because this address was used on LifeKeel.' },
  })
  return { subject, text, html }
}

/**
 * Sends the code and reports an outcome instead of throwing (§6.8):
 * `sent` = provider accepted; `failed` = definite rejection, safe to resend at
 * once; `unknown` = timed out or the connection dropped after the request
 * left, so the code may still arrive. The code is never logged outside dev.
 */
export async function sendOtpEmail(
  to: string,
  name: string,
  code: string,
  purpose: OtpPurpose,
): Promise<OtpDelivery> {
  if (!emailConfigured()) {
    const isDev =
      !process.env['NODE_ENV'] || ['development', 'test'].includes(process.env['NODE_ENV'])
    if (isDev) {
      log.warn(
        { to, purpose, code },
        'No email provider configured — dev only: OTP code logged instead of sent',
      )
      return 'sent'
    }
    log.error({ to, purpose }, 'No email provider configured — OTP email not sent')
    return 'failed'
  }
  const apiKey = process.env['SENDGRID_API_KEY']
  if (apiKey) sgMail.setApiKey(apiKey)
  const { subject, text, html } = otpEmailContent(name, code, purpose)
  const send = sgMail.send({
    to,
    from: { email: getFromEmail(), name: 'LifeKeel' },
    subject,
    text,
    html,
    trackingSettings: { clickTracking: { enable: false }, openTracking: { enable: false } },
  })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), OTP_SEND_TIMEOUT_MS)
  })
  try {
    const outcome = await Promise.race([send.then(() => 'ok' as const), timeout])
    if (outcome === 'timeout') {
      send.catch(() => {})
      log.warn({ to, purpose }, 'OTP email send timed out — delivery unknown')
      return 'unknown'
    }
    log.info({ to, purpose }, 'OTP email sent')
    return 'sent'
  } catch (err) {
    // SendGrid errors with an HTTP status are definite rejections; anything
    // else (socket reset, DNS) may have left after the request was written.
    const status = (err as { code?: unknown }).code
    const definite = typeof status === 'number' && status >= 400
    log.error({ to, purpose, status }, 'OTP email send failed')
    return definite ? 'failed' : 'unknown'
  } finally {
    clearTimeout(timer)
  }
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
): Promise<void> {
  if (!emailConfigured()) {
    log.warn({ to }, 'No email provider configured — skipping password reset email')
    return
  }

  const apiKey = process.env['SENDGRID_API_KEY']
  if (apiKey) sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'LifeKeel' },
      subject: 'Reset your password',
      text: `Hi ${firstName},\n\nWe received a request to reset your password. Reset it here (link expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
      html: renderEmail({
        preheader: 'Reset your LifeKeel password. The link expires in 1 hour.',
        eyebrow: 'Your account',
        title: 'Reset your password',
        bodyHtml:
          p(`Hi ${escapeHtml(firstName)},`) +
          p('We received a request to reset your password. This link expires in 1 hour.'),
        cta: { url: resetUrl, label: 'Reset password' },
        note: "If you didn't request this, you can safely ignore this email — your password won't change.",
        footer: {
          reason: 'You got this because a password reset was requested for your LifeKeel account.',
        },
      }),
    })
    log.info({ to }, 'Password reset email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send password reset email')
  }
}

// PRD-123: per-member invitation. The token-bearing URL is how the recipient
// claims the pending roster entry the organizer created for them, so it
// never lands in logs — only `to` is logged, matching the reset email above.
export async function sendFamilyInviteEmail(
  to: string,
  name: string,
  familyName: string,
  inviteUrl: string,
): Promise<void> {
  if (!emailConfigured()) {
    log.warn({ to }, 'No email provider configured — skipping family invite email')
    return
  }

  const apiKey = process.env['SENDGRID_API_KEY']
  if (apiKey) sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'LifeKeel' },
      subject: `${familyName} invited you to LifeKeel`,
      text: `Hi ${firstName},\n\n${familyName} has set you up as a member of their family on LifeKeel. Accept the invitation to create your sign-in (link expires in 7 days):\n${inviteUrl}\n\nIf you weren't expecting this, you can safely ignore it — no account is created unless you accept.`,
      html: renderEmail({
        preheader: `${familyName} set you up as a family member on LifeKeel.`,
        eyebrow: 'Family invitation',
        title: `${familyName} invited you to LifeKeel`,
        bodyHtml:
          p(`Hi ${escapeHtml(firstName)},`) +
          p(
            `<strong>${escapeHtml(familyName)}</strong> has set you up as a member of their family on LifeKeel. Accept the invitation to create your sign-in. This link expires in 7 days.`,
          ),
        cta: { url: inviteUrl, label: 'Accept invitation' },
        note: "If you weren't expecting this, you can safely ignore it — no account is created unless you accept.",
        footer: {
          reason: 'You got this because a family on LifeKeel added this address as a member.',
        },
      }),
    })
    log.info({ to }, 'Family invite email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send family invite email')
  }
}

// PRD-130: continuity switch. The check-in goes to the organizer; the
// alert goes to their designated family members. Both are informational —
// nothing unlocks, no access is granted; the family vault's standing
// adult access means there is nothing for this to release.
export async function sendContinuityCheckInEmail(
  to: string,
  name: string,
  daysInactive: number,
  appUrl: string,
): Promise<void> {
  if (!emailConfigured()) {
    log.warn({ to }, 'No email provider configured — skipping continuity check-in email')
    return
  }
  const apiKey = process.env['SENDGRID_API_KEY']
  if (apiKey) sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'
  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'LifeKeel' },
      subject: 'Still there? A quick check-in for your family plan',
      text: `Hi ${firstName},\n\nYou set up a continuity check-in for your family on LifeKeel, and we haven't seen you in ${daysInactive} days. If everything's fine, just open the app — that resets the clock automatically:\n${appUrl}\n\nIf we don't hear from you, your designated family members will get a gentle nudge with your family's continuity plan.`,
      html: renderEmail({
        preheader: `We haven't seen you in ${daysInactive} days. Opening the app resets the clock.`,
        eyebrow: 'Continuity check-in',
        title: 'Still there?',
        bodyHtml:
          p(`Hi ${escapeHtml(firstName)},`) +
          p(
            `You set up a continuity check-in for your family on LifeKeel, and we haven't seen you in <strong>${daysInactive} days</strong>.`,
          ) +
          p("If everything's fine, just open the app — that resets the clock automatically."),
        cta: { url: appUrl, label: 'Open LifeKeel' },
        note: "If we don't hear from you, your designated family members will get a gentle nudge with your family's continuity plan.",
        footer: {
          reason: 'You got this because you turned on the continuity check-in for your family.',
          manageUrl: `${appUrl}/settings#notifications`,
        },
      }),
    })
    log.info({ to }, 'Continuity check-in email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send continuity check-in email')
  }
}

export async function sendContinuityAlertEmail(
  to: string,
  memberName: string,
  organizerName: string,
  daysInactive: number,
  appUrl: string,
): Promise<void> {
  if (!emailConfigured()) {
    log.warn({ to }, 'No email provider configured — skipping continuity alert email')
    return
  }
  const apiKey = process.env['SENDGRID_API_KEY']
  if (apiKey) sgMail.setApiKey(apiKey)
  const firstName = memberName.split(' ')[0] || 'there'
  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'LifeKeel' },
      subject: `${organizerName} asked us to check in — LifeKeel family continuity`,
      text: `Hi ${firstName},\n\n${organizerName} named you as a continuity contact for your family's LifeKeel plan. They haven't checked in for ${daysInactive} days, despite a reminder.\n\nThis is probably nothing — people get busy. But if something has happened, your family's emergency documents and plans are already in the vault you have access to:\n${appUrl}\n\nNo action is needed if ${organizerName} is fine — the moment they open the app, this alert clears itself.`,
      html: renderEmail({
        preheader: `${organizerName} hasn't checked in for ${daysInactive} days. This is probably nothing.`,
        eyebrow: 'Family continuity',
        title: `${organizerName} asked us to check in`,
        bodyHtml:
          p(`Hi ${escapeHtml(firstName)},`) +
          p(
            `<strong>${escapeHtml(organizerName)}</strong> named you as a continuity contact for your family's LifeKeel plan. They haven't checked in for <strong>${daysInactive} days</strong>, despite a reminder.`,
          ) +
          p(
            "This is probably nothing — people get busy. But if something has happened, your family's emergency documents and plans are already in the vault you have access to.",
          ),
        cta: { url: appUrl, label: 'Open LifeKeel' },
        note: `No action is needed if ${organizerName} is fine — the moment they open the app, this alert clears itself.`,
        footer: {
          reason: `You got this because ${organizerName} named you as a continuity contact.`,
        },
      }),
    })
    log.info({ to }, 'Continuity alert email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send continuity alert email')
  }
}

// PRD-136 §4: the family heartbeat — same shell conventions as the
// continuity emails above. Content comes pre-rendered from
// feed/render-heartbeat.ts so this stays a thin transport.
export function buildHeartbeatMessage(
  to: string,
  firstName: string,
  rendered: { subject: string; text: string; html: string },
  unsubscribeUrl?: string,
) {
  const unsubText = unsubscribeUrl ? `\n\nStop these emails: ${unsubscribeUrl}` : ''
  return {
    to,
    from: { email: getFromEmail(), name: 'LifeKeel' },
    subject: rendered.subject,
    // rendered.text/html are addressed generically ("Hi,") — prepend the
    // name in text so the email reads personally.
    text: `Hi ${firstName},\n\n${rendered.text}${unsubText}`,
    html: renderEmail({
      preheader: rendered.subject,
      eyebrow: 'Family heartbeat',
      title: rendered.subject,
      bodyHtml: rendered.html.replace('<p>Hi,</p>', `<p>Hi ${escapeHtml(firstName)},</p>`),
      footer: {
        reason: 'You got this because your family gets the LifeKeel heartbeat.',
        unsubscribeUrl,
      },
    }),
    ...(unsubscribeUrl
      ? {
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
      : {}),
  }
}

// Returns a delivery result instead of void so the caller can tell a real
// send from a skipped/failed one — the heartbeat job records its idempotency
// row only on `ok`, so a failed cycle is retried rather than silently lost.
export type HeartbeatDeliveryResult =
  { ok: true } | { ok: false; reason: 'no_api_key' | 'send_failed' }

export async function sendHeartbeatEmail(
  to: string,
  name: string,
  rendered: { subject: string; text: string; html: string },
  /** Signed one-click opt-out URL (routes/heartbeat-unsubscribe.ts). Sent as
   *  List-Unsubscribe + List-Unsubscribe-Post (RFC 8058) and in the footer. */
  unsubscribeUrl?: string,
): Promise<HeartbeatDeliveryResult> {
  if (!emailConfigured()) {
    log.warn({ to }, 'No email provider configured — skipping heartbeat email')
    return { ok: false, reason: 'no_api_key' }
  }
  const apiKey = process.env['SENDGRID_API_KEY']
  if (apiKey) sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'
  try {
    await sgMail.send(buildHeartbeatMessage(to, firstName, rendered, unsubscribeUrl))
    log.info({ to }, 'Heartbeat email sent')
    return { ok: true }
  } catch (err) {
    log.error({ to, err }, 'Failed to send heartbeat email')
    return { ok: false, reason: 'send_failed' }
  }
}
