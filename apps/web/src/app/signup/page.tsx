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

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || password.length < 8) return
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

      <div className="lk-field">
        <label htmlFor="signup-name">Your name</label>
        <input
          id="signup-name"
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
          autoComplete="name"
          className="lk-input"
        />
      </div>
      <div className="lk-field">
        <label htmlFor="signup-email">Email address</label>
        <input
          id="signup-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
          autoComplete="email"
          className="lk-input"
        />
      </div>
      <div className="lk-field">
        <label htmlFor="signup-password">Password (min. 8 characters)</label>
        <PasswordInput
          id="signup-password"
          placeholder="Password"
          value={password}
          onChange={setPassword}
          onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
          autoComplete="new-password"
          inputClassName="lk-input"
          wrapperClassName="lk-pw"
          toggleClassName="lk-pw-toggle"
        />
        {/* Live-verification finding: the only feedback for a too-short
            password was the Create Account button staying disabled, with
            no visible reason beyond the static label. This updates as they
            type instead of only failing silently at submit. */}
        {password.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className={`lk-hint ${password.length >= 8 ? 'lk-ok' : ''}`}
          >
            {password.length >= 8
              ? 'Password length looks good'
              : `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed`}
          </div>
        )}
      </div>

      {error && (
        <p role="status" aria-live="polite" className="lk-err">
          {error}
        </p>
      )}

      <button
        type="button"
        className="lk-btn"
        onClick={handleSignUp}
        disabled={!name.trim() || !email.trim() || password.length < 8 || loading}
      >
        {loading ? 'Creating...' : 'Create Account'}
      </button>

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
