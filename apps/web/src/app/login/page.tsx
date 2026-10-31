'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GoogleIcon } from '@/components/GoogleIcon'
import { PasswordInput } from '@/components/PasswordInput'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { safeNext, stashReturnTo } from '@/lib/return-to'
import { RegionSwitch } from '@/components/RegionSwitch'
import { AuthShell } from '@/components/landing/AuthShell'
import { Turnstile, useTurnstile } from '@/components/security/Turnstile'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaPending, setMfaPending] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signIn, verifyMfaCode, signInWithProvider } = useAuth()
  const router = useRouter()
  const captcha = useTurnstile()

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
    if (loading) return
    if (!email.trim() || !password) {
      setError('Enter your email address and password.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const nextParam = new URLSearchParams(window.location.search).get('next')
      const result = await signIn(email, password, {
        turnstileToken: captcha.consume(),
        ...(nextParam?.startsWith('/') && !nextParam.startsWith('//') ? { next: nextParam } : {}),
      })
      if (result.otpRequired) {
        // Emailed code is the second step (CLOUDFLARE_INTEGRATION.md §6.5).
        haptic('light')
        router.push('/verify-otp')
        return
      }
      if (result.mfaRequired) {
        // Second step — swap to the authenticator-code entry instead of
        // navigating. The pending token stays in memory in auth-context.
        setMfaPending(true)
        setLoading(false)
        return
      }
      haptic('success')
      const next = new URLSearchParams(window.location.search).get('next')
      router.push(next?.startsWith('/') && !next.startsWith('//') ? next : '/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  const handleVerifyMfa = async () => {
    if (loading) return
    if (!mfaCode.trim()) {
      setError('Enter the code from your authenticator app.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const pendingToken = sessionStorage.getItem('lifekeel_mfa_pending') ?? undefined
      await verifyMfaCode(mfaCode.trim(), pendingToken)
      sessionStorage.removeItem('lifekeel_mfa_pending')
      haptic('success')
      const next = new URLSearchParams(window.location.search).get('next')
      router.push(next?.startsWith('/') && !next.startsWith('//') ? next : '/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.')
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    // Google leaves the app and comes back to /auth/callback, so the ?next= in this
    // URL is parked for the callback to read (a brief link must land on the brief).
    const next = safeNext(new URLSearchParams(window.location.search).get('next'))
    stashReturnTo(next)
    try {
      await signInWithProvider('google')
      haptic('medium')
      router.push(next ?? '/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  return (
    <AuthShell
      intro="login"
      title="Welcome back"
      sub={mfaPending ? 'Two-factor authentication' : 'Sign in to your family'}
      aside={<RegionSwitch />}
    >
      {mfaPending ? (
        <form
          className="lk-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void handleVerifyMfa()
          }}
        >
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
              className="lk-input center"
              aria-invalid={error ? true : undefined}
              aria-describedby="login-error"
            />
          </div>
          <div id="login-error" role="alert" className="lk-err">
            {error ?? ''}
          </div>
          <button type="submit" className="lk-btn" disabled={loading}>
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
        </form>
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

          <form
            className="lk-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void handleSignIn()
            }}
          >
            <div className="lk-field">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="lk-input"
                aria-invalid={error ? true : undefined}
                aria-describedby="login-error"
              />
            </div>
            <div className="lk-field">
              <label htmlFor="login-password">Password</label>
              <PasswordInput
                id="login-password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                inputClassName="lk-input"
                wrapperClassName="lk-pw"
                toggleClassName="lk-pw-toggle"
                invalid={!!error}
                describedBy="login-error"
              />
            </div>

            <Turnstile
              ref={captcha.ref}
              action="login"
              appearance="interaction-only"
              onToken={captcha.onToken}
              onExpire={captcha.onExpire}
            />

            <div id="login-error" role="alert" className="lk-err">
              {error ?? ''}
            </div>

            <button type="submit" className="lk-btn" disabled={loading || !captcha.ready}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <Link href="/reset-password" className="lk-textlink" onClick={() => haptic('light')}>
              Forgot password?
            </Link>
          </form>
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
