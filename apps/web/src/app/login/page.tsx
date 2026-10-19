'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GoogleIcon } from '@/components/GoogleIcon'
import { PasswordInput } from '@/components/PasswordInput'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { RegionSwitch } from '@/components/RegionSwitch'
import { AuthShell } from '@/components/landing/AuthShell'

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
      email_not_verified:
        'Your provider could not verify that email address. Try another sign-in method.',
      signups_disabled: 'New accounts are temporarily closed — sign in if you already have one.',
      invalid_oauth_state: 'That sign-in link expired — please try again.',
      missing_oauth_params: 'Sign-in was interrupted — please try again.',
    }
    setError(messages[code] ?? 'Sign-in failed. Please try again.')
  }, [])

  // OAuth second factor: /auth/callback forwards the pending token here as
  // ?mfa=1 after stashing it in sessionStorage. Straight to the code step —
  // the password form is irrelevant (Google/GitHub has none).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('mfa') === '1' && sessionStorage.getItem('lifekeel_mfa_pending')) {
      setMfaPending(true)
    }
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
      const pendingToken = sessionStorage.getItem('lifekeel_mfa_pending') ?? undefined
      await verifyMfaCode(mfaCode.trim(), pendingToken)
      sessionStorage.removeItem('lifekeel_mfa_pending')
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
    <AuthShell
      title="Welcome back"
      sub={mfaPending ? 'Two-factor authentication' : 'Sign in to your family'}
      aside={<RegionSwitch />}
    >
      {mfaPending ? (
        <>
          <div className="lk-field">
            <label htmlFor="mfa-code">
              Enter the 6-digit code from your authenticator app, or a recovery code
            </label>
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
              className="lk-input center"
            />
          </div>
          {error && (
            <p role="status" aria-live="polite" className="lk-err">
              {error}
            </p>
          )}
          <button
            type="button"
            className="lk-btn"
            onClick={handleVerifyMfa}
            disabled={!mfaCode.trim() || loading}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <button
            type="button"
            className="lk-textlink lk-textlink-muted"
            onClick={() => {
              setMfaPending(false)
              setMfaCode('')
              setError(null)
              sessionStorage.removeItem('lifekeel_mfa_pending')
            }}
          >
            Back to sign in
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="lk-btn lk-btn-google"
            onClick={handleGoogle}
            disabled={loading}
          >
            <GoogleIcon size={20} /> Continue with Google
          </button>

          <div className="lk-or">or use email</div>

          <div className="lk-field">
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
              autoComplete="email"
              className="lk-input"
            />
          </div>
          <div className="lk-field">
            <label htmlFor="login-password">Password</label>
            <PasswordInput
              id="login-password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
              onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
              autoComplete="current-password"
              inputClassName="lk-input"
              wrapperClassName="lk-pw"
              toggleClassName="lk-pw-toggle"
            />
          </div>

          <Link href="/reset-password" className="lk-textlink" onClick={() => haptic('light')}>
            Forgot password?
          </Link>

          {error && (
            <p role="status" aria-live="polite" className="lk-err">
              {error}
            </p>
          )}

          <button
            type="button"
            className="lk-btn"
            onClick={handleSignIn}
            disabled={!email.trim() || !password || loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="lk-hint lk-center">
            New to LifeKeel?{' '}
            <Link href="/signup" className="lk-textlink">
              Create an account
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}
