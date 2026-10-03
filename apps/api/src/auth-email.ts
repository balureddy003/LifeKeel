/**
 * Transactional auth email — password reset.
 *
 * Separate from delivery/channels.ts's EmailChannel, which is tightly
 * coupled to insight-notification copy (buildEmailHtml(InsightNotification)).
 * This is generic account mail, sent the same way (SendGrid, same env vars)
 * but with its own templates.
 *
 * Gracefully no-ops when SENDGRID_API_KEY isn't configured — matching the
 * OCR extraction pattern (apps/api/src/ocr/extract.ts): the request still
 * succeeds, a warning is logged, and nothing crashes for users running
 * without an email provider configured.
 */

import sgMail from '@sendgrid/mail'
import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'auth-email', version: '0.0.0' })

function getFromEmail(): string {
  return process.env['SENDGRID_FROM_EMAIL'] ?? 'accounts@agentoak.ai'
}

// Sent on signup, email change, and resend-verification. The token-bearing
// URL is how the recipient proves mailbox ownership, so it never lands in
// logs — only `to` is logged, matching every helper in this file.
export async function sendEmailVerificationEmail(to: string, name: string, verifyUrl: string): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to }, 'No SENDGRID_API_KEY — skipping email verification email')
    return
  }

  sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'Kairos' },
      subject: 'Verify your email',
      text: `Hi ${firstName},\n\nPlease verify this email address for your Agent Oak account (link expires in 24 hours):\n${verifyUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: `
        <p>Hi ${firstName},</p>
        <p>Please verify this email address for your Agent Oak account. This link expires in 24 hours.</p>
        <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;background:#7c6ef0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Verify email</a></p>
        <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      `,
    })
    log.info({ to }, 'Email verification sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send email verification')
  }
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to }, 'No SENDGRID_API_KEY — skipping password reset email')
    return
  }

  sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'Kairos' },
      subject: 'Reset your password',
      text: `Hi ${firstName},\n\nWe received a request to reset your password. Reset it here (link expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
      html: `
        <p>Hi ${firstName},</p>
        <p>We received a request to reset your password. This link expires in 1 hour.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#7c6ef0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Reset password</a></p>
        <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      `,
    })
    log.info({ to }, 'Password reset email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send password reset email')
  }
}

// PRD-123: per-member invitation. The token-bearing URL is how the recipient
// claims the pending roster entry the organizer created for them, so it
// never lands in logs — only `to` is logged, matching the reset email above.
export async function sendFamilyInviteEmail(to: string, name: string, familyName: string, inviteUrl: string): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to }, 'No SENDGRID_API_KEY — skipping family invite email')
    return
  }

  sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'Kairos' },
      subject: `${familyName} invited you to Agent Oak`,
      text: `Hi ${firstName},\n\n${familyName} has set you up as a member of their family on Agent Oak. Accept the invitation to create your sign-in (link expires in 7 days):\n${inviteUrl}\n\nIf you weren't expecting this, you can safely ignore it — no account is created unless you accept.`,
      html: `
        <p>Hi ${firstName},</p>
        <p><strong>${familyName}</strong> has set you up as a member of their family on Agent Oak. Accept the invitation to create your sign-in. This link expires in 7 days.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 20px;background:#7c6ef0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Accept invitation</a></p>
        <p style="color:#888;font-size:13px;">If you weren't expecting this, you can safely ignore it — no account is created unless you accept.</p>
      `,
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
export async function sendContinuityCheckInEmail(to: string, name: string, daysInactive: number, appUrl: string): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to }, 'No SENDGRID_API_KEY — skipping continuity check-in email')
    return
  }
  sgMail.setApiKey(apiKey)
  const firstName = name.split(' ')[0] || 'there'
  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'Kairos' },
      subject: 'Still there? A quick check-in for your family plan',
      text: `Hi ${firstName},\n\nYou set up a continuity check-in for your family on Agent Oak, and we haven't seen you in ${daysInactive} days. If everything's fine, just open the app — that resets the clock automatically:\n${appUrl}\n\nIf we don't hear from you, your designated family members will get a gentle nudge with your family's continuity plan.`,
      html: `
        <p>Hi ${firstName},</p>
        <p>You set up a continuity check-in for your family on Agent Oak, and we haven't seen you in <strong>${daysInactive} days</strong>.</p>
        <p>If everything's fine, just open the app — that resets the clock automatically.</p>
        <p><a href="${appUrl}" style="display:inline-block;padding:12px 20px;background:#7c6ef0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Open Agent Oak</a></p>
        <p style="color:#888;font-size:13px;">If we don't hear from you, your designated family members will get a gentle nudge with your family's continuity plan.</p>
      `,
    })
    log.info({ to }, 'Continuity check-in email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send continuity check-in email')
  }
}

export async function sendContinuityAlertEmail(to: string, memberName: string, organizerName: string, daysInactive: number, appUrl: string): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to }, 'No SENDGRID_API_KEY — skipping continuity alert email')
    return
  }
  sgMail.setApiKey(apiKey)
  const firstName = memberName.split(' ')[0] || 'there'
  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'Kairos' },
      subject: `${organizerName} asked us to check in — Agent Oak family continuity`,
      text: `Hi ${firstName},\n\n${organizerName} named you as a continuity contact for your family's Agent Oak plan. They haven't checked in for ${daysInactive} days, despite a reminder.\n\nThis is probably nothing — people get busy. But if something has happened, your family's emergency documents and plans are already in the vault you have access to:\n${appUrl}\n\nNo action is needed if ${organizerName} is fine — the moment they open the app, this alert clears itself.`,
      html: `
        <p>Hi ${firstName},</p>
        <p><strong>${organizerName}</strong> named you as a continuity contact for your family's Agent Oak plan. They haven't checked in for <strong>${daysInactive} days</strong>, despite a reminder.</p>
        <p>This is probably nothing — people get busy. But if something has happened, your family's emergency documents and plans are already in the vault you have access to.</p>
        <p><a href="${appUrl}" style="display:inline-block;padding:12px 20px;background:#7c6ef0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Open Agent Oak</a></p>
        <p style="color:#888;font-size:13px;">No action is needed if ${organizerName} is fine — the moment they open the app, this alert clears itself.</p>
      `,
    })
    log.info({ to }, 'Continuity alert email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send continuity alert email')
  }
}
