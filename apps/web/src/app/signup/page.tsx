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
import { track } from '@/lib/growth-track'
import { trackConversion } from '@/lib/ad-track'
import { fetchPublicStatus } from '@/lib/api'

export default function SignUpPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refCode, setRefCode] = useState<string | undefined>(undefined)
  const [signupsOpen, setSignupsOpen] = useState<boolean | null>(null)
  const { signUp, signInWithProvider } = useAuth()
  const router = useRouter()

  // PRD-112: carried through from a friend's referral link
  // (/signup?ref=<code>), same window.location.search convention as
  // /life-events's own ?type=.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref) setRefCode(ref)
    // Operator-controlled kill-switch: /status stays public so the page can
    // render a closed state instead of a raw 503 on submit. An unreachable
    // API resolves to "open" (fetchPublicStatus's fallback) — the backend
    // 503 still guards the actual signup call either way.
    fetchPublicStatus().then((s) => setSignupsOpen(s.signups_enabled))
  }, [])

  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; password?: string }>({})

  const validate = () => {
    const e: { name?: string; email?: string; password?: string } = {}
    if (!name.trim()) e.name = 'Enter your name.'
    if (!email.trim()) e.email = 'Enter your email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = 'That email address looks incomplete.'
    if (password.length < 8) e.password = 'Use at least 8 characters.'
    setFieldErrors(e)
    const first = (['name', 'email', 'password'] as const).find((k) => e[k])
    if (first) document.getElementById(`signup-${first}`)?.focus()
    return !first
  }

  const handleSignUp = async () => {
    if (loading || !validate()) return
    setLoading(true)
    setError(null)
    try {
      await signUp(name, email, password, refCode)
      haptic('success')
      track('signup_completed', { method: 'password' })
      trackConversion('signup')
      router.push('/family-setup')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Sign up failed. Please try again.')
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    try {
      await signInWithProvider('google')
      haptic('medium')
      track('signup_completed', { method: 'google' })
      trackConversion('signup')
      router.push('/family-setup')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  if (signupsOpen === false) {
    return (
      <AuthShell
        title="Signups are temporarily closed"
        sub="We're not accepting new accounts right now. Please check back soon."
      >
        <Link href="/login" className="lk-btn lk-btn-quiet">
          I already have an account
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      sub="Takes 30 seconds. No credit card needed."
      aside={<RegionSwitch />}
    >
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
          void handleSignUp()
        }}
      >
        <div className="lk-field">
          <label htmlFor="signup-name">Your name</label>
          <input
            id="signup-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="lk-input"
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? 'signup-name-err' : undefined}
          />
          {fieldErrors.name && (
            <p id="signup-name-err" className="lk-err lk-err-field">
              {fieldErrors.name}
            </p>
          )}
        </div>
        <div className="lk-field">
          <label htmlFor="signup-email">Email address</label>
          <input
            id="signup-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="lk-input"
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'signup-email-err' : undefined}
          />
          {fieldErrors.email && (
            <p id="signup-email-err" className="lk-err lk-err-field">
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div className="lk-field">
          <label htmlFor="signup-password">Password (at least 8 characters)</label>
          <PasswordInput
            id="signup-password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            inputClassName="lk-input"
            wrapperClassName="lk-pw"
            toggleClassName="lk-pw-toggle"
            invalid={!!fieldErrors.password}
            describedBy="signup-password-hint"
          />
          {/* Permanent polite region: a region inserted with its text already in it is often not
              announced, so the element stays mounted and only its text changes. */}
          <div
            id="signup-password-hint"
            role="status"
            aria-live="polite"
            className={`lk-hint ${password.length >= 8 ? 'lk-ok' : ''}`}
          >
            {password.length === 0
              ? (fieldErrors.password ?? '')
              : password.length >= 8
                ? 'Password length looks good'
                : `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed`}
          </div>
        </div>

        <div role="alert" className="lk-err">
          {error ?? ''}
        </div>

        <button type="submit" className="lk-btn" disabled={loading}>
          {loading ? 'Creating...' : 'Create your free account'}
        </button>
      </form>

      <p className="lk-hint lk-center">
        Next you add the people in your household, then what you have on file. Your financial data
        isn&apos;t sold.
      </p>

      <p className="lk-hint lk-center">
        By continuing, you agree to our{' '}
        <Link href="/terms" className="lk-textlink">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="lk-textlink">
          Privacy Policy
        </Link>
        .
      </p>
      <p className="lk-hint lk-center">
        Already have an account?{' '}
        <Link href="/login" className="lk-textlink">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
