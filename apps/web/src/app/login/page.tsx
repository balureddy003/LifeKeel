'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GoogleIcon } from '@/components/GoogleIcon'
import { PasswordInput } from '@/components/PasswordInput'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaPending, setMfaPending] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signIn, verifyMfaCode, signInWithProvider } = useAuth()
  const router = useRouter()

  // OAuth callbacks redirect back here as /login?error=<code> on failure —
  // surface a real message instead of landing silently. The codes come from
  // auth-social.ts's getLoginErrorUrl call sites.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    if (!code) return
    const messages: Record<string, string> = {
      workspace_taken: 'That workspace name is already taken — try signing in, or contact support.',
      email_not_verified: 'Your provider could not verify that email address. Try another sign-in method.',
      signups_disabled: 'New accounts are temporarily closed — sign in if you already have one.',
      invalid_oauth_state: 'That sign-in link expired — please try again.',
      missing_oauth_params: 'Sign-in was interrupted — please try again.',
    }
    setError(messages[code] ?? 'Sign-in failed. Please try again.')
  }, [])

  const handleSignIn = async () => {
    if (!email.trim() || !password) return
    setLoading(true)
    setError(null)
    try {
      const result = await signIn(email, password)
      if (result.mfaRequired) {
        // Second step — swap to the authenticator-code entry instead of
        // navigating. The pending token stays in memory in auth-context.
        setMfaPending(true)
        setLoading(false)
        return
      }
      haptic('success')
      router.push('/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  const handleVerifyMfa = async () => {
    if (!mfaCode.trim()) return
    setLoading(true)
    setError(null)
    try {
      await verifyMfaCode(mfaCode.trim())
      haptic('success')
      router.push('/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.')
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    try {
      await signInWithProvider('google')
      haptic('medium')
      router.push('/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="text-center mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- matches MarketingLanding.tsx's own /icon.svg usage */}
        <img src="/icon.svg" alt="" width={64} height={64} className="rounded-3xl mx-auto mb-3" />
        <h1 className="text-2xl font-semibold tracking-tight bg-gradient-to-r from-family-400 to-family-500 bg-clip-text text-transparent">Welcome back</h1>
        <p className="text-sm text-ink-tertiary mt-1">{mfaPending ? 'Two-factor authentication' : 'Sign in to your family'}</p>
      </div>

      {mfaPending ? (
        <div className="space-y-3">
          <label htmlFor="mfa-code" className="block">
            <div className="text-xs text-ink-tertiary mb-1.5 px-1">Enter the 6-digit code from your authenticator app, or a recovery code</div>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyMfa()}
              className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all text-center tracking-widest"
            />
          </label>
          {error && (
            <p role="status" aria-live="polite" className="text-sm text-danger text-center">{error}</p>
          )}
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={handleVerifyMfa}
            disabled={!mfaCode.trim() || loading}
            className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
          >
            {loading ? 'Verifying...' : 'Verify'}
          </motion.button>
          <button
            onClick={() => { setMfaPending(false); setMfaCode(''); setError(null) }}
            className="w-full text-sm text-ink-tertiary font-semibold text-center"
          >
            Back to sign in
          </button>
        </div>
      ) : (
      <>

      <div className="space-y-3 mb-6">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleGoogle}
          disabled={loading}
          className="w-full glass rounded-2xl py-4 font-semibold flex items-center justify-center gap-2"
        >
          <GoogleIcon size={20} /> Continue with Google
        </motion.button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-px bg-tint/10" />
        <span className="text-xs text-ink-tertiary">or use email</span>
        <div className="flex-1 h-px bg-tint/10" />
      </div>

      <div className="space-y-3 mb-6">
        <label htmlFor="login-email" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Email address</div>
          <input
            id="login-email"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
            autoComplete="email"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <div>
          <label htmlFor="login-password" className="block text-xs text-ink-tertiary mb-1.5 px-1">Password</label>
          <PasswordInput
            id="login-password"
            placeholder="Password"
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
            autoComplete="current-password"
          />
        </div>
      </div>

      <Link
        href="/reset-password"
        className="text-sm text-family-400 font-semibold text-center mb-6 -mt-2"
        onClick={() => haptic('light')}
      >
        Forgot password?
      </Link>

      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger text-center mb-4">{error}</p>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSignIn}
        disabled={!email.trim() || !password || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </motion.button>
      </>
      )}
    </div>
  )
}
