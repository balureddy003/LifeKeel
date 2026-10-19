'use client'

import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'

export type SignupMode = 'account'
// PRD-152 will add an 'email' mode with an address field. Until the sign-in link
// exists, the card only sends people to the existing sign-up page and must not
// promise a passwordless sign-in.

/**
 * Direct signup on the existing flow. Plain <a> to the app host: the landing hosts
 * redirect app paths, so next/link would fetch the RSC payload across that redirect.
 * No email is read or sent from this card.
 */
export function SignupCard({ location = 'hero' }: { mode?: SignupMode; location?: string }) {
  return (
    <div className="lk-card" id="signup">
      <a
        className="lk-btn lk-once"
        href={appUrl('/signup')}
        onClick={() => {
          haptic('light')
          track('landing_cta_click', { location, method: 'signup' })
        }}
      >
        Create your free account
      </a>
      <p className="lk-fine">On the next page you can use Google, or an email and a password.</p>
      <p className="lk-fine">
        Already have an account?{' '}
        <a href={appUrl('/login')} onClick={() => track('landing_signin_click', { location })}>
          Sign in
        </a>
      </p>
      <p className="lk-legal">
        LifeKeel is for adults, 18 and over. By continuing you agree to the{' '}
        <a href="/terms">Terms</a>. The <a href="/privacy">Privacy notice</a> explains how we use
        your data. Information only, not regulated advice.
      </p>
    </div>
  )
}
