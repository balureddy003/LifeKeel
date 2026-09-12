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
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'auth-email', version: '0.0.0' })

function getFromEmail(): string {
  return process.env['SENDGRID_FROM_EMAIL'] ?? 'accounts@kairos.dev'
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
