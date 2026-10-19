'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { verifyEmail, resendVerificationEmail } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { AuthShell } from '@/components/landing/AuthShell'

type VerifyState = 'checking' | 'verifying' | 'verified' | 'invalid' | 'no-token'

export default function VerifyEmailPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [state, setState] = useState<VerifyState>('checking')
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)
  // React strict-mode double-invokes effects — the token is single-use
  // server-side (cleared on success), so without a guard the second mount
  // would call verify again and render a false "invalid link" error.
  const started = useRef(false)

  // Same pattern as /reset-password/confirm: read the token from the query
  // string on the client to avoid the useSearchParams Suspense requirement
  // a static export otherwise needs.
  useEffect(() => {
    if (started.current) return
    started.current = true
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setState('no-token')
      return
    }
    setState('verifying')
    verifyEmail(token)
      .then(() => {
        haptic('success')
        setState('verified')
        setTimeout(() => router.push(isAuthenticated ? '/' : '/login'), 2500)
      })
      .catch((err) => {
        haptic('warning')
        setState('invalid')
        setError(err instanceof Error ? err.message : "That link didn't work — request a new one.")
      })
  }, [router, isAuthenticated])

  const handleResend = async () => {
    haptic('light')
    setResending(true)
    setError(null)
    try {
      // Signed-in visitors get the token-resolved path; signed-out ones use
      // the email the server already has — no form needed.
      await resendVerificationEmail()
      setResent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't resend — try again in a moment.")
    } finally {
      setResending(false)
    }
  }

  if (state === 'checking' || state === 'verifying') {
    return <AuthShell title="Verifying your email" sub="One moment..." />
  }

  if (state === 'verified') {
    return (
      <AuthShell
        title="Email verified"
        sub={isAuthenticated ? 'Taking you home...' : 'Taking you to sign in...'}
      />
    )
  }

  return (
    <AuthShell
      title={state === 'no-token' ? 'Invalid verification link' : 'Link expired or already used'}
      sub={
        state === 'no-token'
          ? 'This link is missing its verification token. Sign in and we will send you a fresh one.'
          : 'Verification links expire after 24 hours and can only be used once.'
      }
    >
      {error && (
        <p role="status" aria-live="polite" className="lk-err">
          {error}
        </p>
      )}
      {isAuthenticated ? (
        resent ? (
          <p className="lk-hint lk-ok lk-center">
            A fresh verification link is on its way to your inbox.
          </p>
        ) : (
          <button type="button" className="lk-btn" onClick={handleResend} disabled={resending}>
            {resending ? 'Sending...' : 'Send me a new link'}
          </button>
        )
      ) : (
        <p className="lk-hint lk-center">
          Sign in and use the verification prompt to send a fresh link.
        </p>
      )}
      <Link href={isAuthenticated ? '/' : '/login'} className="lk-btn lk-btn-quiet">
        {isAuthenticated ? 'Back to home' : 'Sign in to get a new link'}
      </Link>
    </AuthShell>
  )
}
