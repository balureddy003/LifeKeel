'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MailCheck, AlertCircle, Loader2 } from 'lucide-react'
import { verifyEmail, resendVerificationEmail } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'

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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <Loader2 size={32} className="text-family-400 animate-spin mb-4" />
        <p className="text-sm text-ink-tertiary">Verifying your email...</p>
      </div>
    )
  }

  if (state === 'verified') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-16 h-16 rounded-3xl bg-success/10 border border-success/20 flex items-center justify-center mb-4"
        >
          <MailCheck size={32} className="text-success" />
        </motion.div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2 bg-gradient-to-r from-family-400 to-family-500 bg-clip-text text-transparent">Email verified</h1>
        <p className="text-sm text-ink-tertiary">
          {isAuthenticated ? 'Taking you home...' : 'Taking you to sign in...'}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-3xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-4">
        <AlertCircle size={32} className="text-danger" />
      </div>
      {/* Plain text, not the brand gradient — same reasoning as the invalid
          reset-link state: an error page shouldn't look cheerful. */}
      <h1 className="text-2xl font-bold mb-2">
        {state === 'no-token' ? 'Invalid verification link' : 'Link expired or already used'}
      </h1>
      <p className="text-sm text-ink-tertiary max-w-xs mb-2">
        {state === 'no-token'
          ? 'This link is missing its verification token. Request a new one to continue.'
          : 'Verification links expire after 24 hours and can only be used once.'}
      </p>
      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger mb-2">{error}</p>
      )}
      {isAuthenticated ? (
        resent ? (
          <p className="text-sm text-success mb-6">A fresh verification link is on its way to your inbox.</p>
        ) : (
          <button
            onClick={handleResend}
            disabled={resending}
            className="text-sm text-family-400 font-semibold mb-6 disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Send me a new link'}
          </button>
        )
      ) : (
        <p className="text-sm text-ink-tertiary max-w-xs mb-6">
          Sign in first, then request a fresh link from the verification prompt.
        </p>
      )}
      <Link href={isAuthenticated ? '/' : '/login'} className="text-sm text-family-400 font-semibold">
        {isAuthenticated ? 'Back to home' : 'Go to sign in'}
      </Link>
    </div>
  )
}
