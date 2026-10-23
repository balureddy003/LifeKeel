/**
 * The email-OTP step between password and session (CLOUDFLARE_INTEGRATION.md §6.7).
 *
 * The pending token is kept in sessionStorage only: it survives a reload of
 * /verify-otp in this tab and dies with the tab. It is cleared on success,
 * on "start over", and when the chain expires. It is a bearer credential for
 * this one step and is never a session.
 */
export type OtpPurpose = 'signup' | 'login'
export type OtpDelivery = 'sent' | 'failed' | 'unknown'

export interface OtpChallenge {
  otp_required: true
  otp_token: string
  email_hint: string
  delivery: OtpDelivery
  code_expires_at: string
  chain_expires_at: string
  resend_available_at: string
}

export interface PendingOtp extends OtpChallenge {
  purpose: OtpPurpose
  /** Where to go after success when not the default post-login redirect. */
  next?: string
}

const KEY = 'lifekeel_otp_pending'

export function savePendingOtp(p: PendingOtp): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode: the page keeps it in memory for this view only */
  }
}

export function readPendingOtp(): PendingOtp | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingOtp
    if (!p?.otp_token || Date.parse(p.chain_expires_at) <= Date.now()) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return p
  } catch {
    return null
  }
}

export function updatePendingOtp(patch: Partial<PendingOtp>): PendingOtp | null {
  const cur = readPendingOtp()
  if (!cur) return null
  const next = { ...cur, ...patch }
  savePendingOtp(next)
  return next
}

export function clearPendingOtp(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function isOtpChallenge(body: unknown): body is OtpChallenge {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { otp_required?: unknown }).otp_required === true &&
    typeof (body as { otp_token?: unknown }).otp_token === 'string'
  )
}
