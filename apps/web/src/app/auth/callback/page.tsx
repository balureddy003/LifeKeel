'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { reportError } from '@/lib/observability'
import { storeSessionToken } from '@/lib/session-token'
import { AuthShell } from '@/components/landing/AuthShell'

export default function AuthCallbackPage() {
  const router = useRouter()
  const { refresh } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const token = params.get('token')
    const tenant = params.get('tenant')
    const err = params.get('error')

    if (err) {
      // Keep the real error on screen — auto-redirecting after 2s discarded
      // it before the user could read or report what actually failed.
      reportError(new Error(`OAuth callback error: ${err}`), { path: '/auth/callback' })
      setError(err)
      return
    }

    const mfaToken = params.get('mfa_token')
    if (mfaToken) {
      // OAuth sign-in on an MFA-enabled account — no session yet; the
      // login page picks the pending token up and shows the code step.
      sessionStorage.setItem('lifekeel_mfa_pending', mfaToken)
      router.push('/login?mfa=1')
      return
    }

    if (token) {
      // The API also set the httpOnly session cookie; the token is kept as
      // the Bearer fallback for cookie-blocked browsers (see lib/http.ts).
      storeSessionToken(token)
      if (tenant) localStorage.setItem('lifekeel_tenant', tenant)
      refresh().then(() => router.replace('/'))
    } else {
      router.push('/login')
    }
  }, [router, refresh])

  if (error) {
    return (
      <AuthShell title="Sign-in failed">
        <p className="text-sm text-danger mb-4">Sign-in failed: {error}</p>
        <button onClick={() => router.push('/login')} className="lk-btn">
          Back to sign in
        </button>
      </AuthShell>
    )
  }

  return <AuthShell title="Signing you in…" />
}
