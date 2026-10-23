/**
 * Cloudflare Turnstile, client side (CLOUDFLARE_INTEGRATION.md §5.1).
 *
 * The site key is public by design and baked in at build time (static
 * export). With no key configured — local dev, where the API defaults to
 * TURNSTILE_MODE=off — the widget renders nothing and forms submit without
 * a token. The token rides in the `cf-turnstile-token` header, never the
 * body, and is single use: forms reset the widget after every submit.
 */
export const TURNSTILE_HEADER = 'cf-turnstile-token'

export type TurnstileAction =
  | 'signup'
  | 'login'
  | 'otp_resend'
  | 'password_reset_request'
  | 'reset_password'
  | 'resend_verification'
  | 'lead'
  | 'family_join'

export function turnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  return key && key.trim() ? key.trim() : null
}

export const turnstileEnabled = (): boolean => turnstileSiteKey() !== null

/** Headers to add to a request; empty when there is no token to send. */
export function turnstileHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { [TURNSTILE_HEADER]: token } : {}
}

/** Server error codes from the Turnstile gate, in words a person can act on. */
export function turnstileErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case 'captcha_required':
      return "Please wait for the security check to finish, then try again."
    case 'captcha_failed':
      return "The security check didn't pass. It has been reset — please try again."
    case 'captcha_unavailable':
      return "We couldn't run the security check just now. Please try again in a moment."
    default:
      return null
  }
}
