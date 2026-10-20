'use client'

/**
 * Landing page for the "keep this result" email (PRD-203). Loading it never
 * consumes the token: the visitor presses Continue, which POSTs. Mail
 * scanners that prefetch links therefore cannot burn it. With no token in the
 * URL the page asks for the emailed code instead, for mail opened on a
 * different device.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { requestMagicLink, type SavedSnapshot } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { AuthShell } from '@/components/landing/AuthShell'

type View = 'loading' | 'continue' | 'code' | 'busy' | 'saved' | 'mfa' | 'expired'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export default function KeepResultPage() {
  const { signInWithMagicLink } = useAuth()
  const [view, setView] = useState<View>('loading')
  const [token, setToken] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<SavedSnapshot | null>(null)
  const [resent, setResent] = useState(false)

  // Read the token on the client (same pattern as /verify-email) and strip it
  // from the address bar so it does not linger in history or screenshots.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token')
    if (t) {
      setToken(t)
      window.history.replaceState(null, '', window.location.pathname)
      setView('continue')
    } else {
      setView('code')
    }
  }, [])

  async function redeem(input: { token: string } | { email: string; code: string }) {
    haptic('light')
    setView('busy')
    setError(null)
    try {
      const result = await signInWithMagicLink(input)
      setSnapshot(result.snapshot)
      setView(result.signed_in ? 'saved' : 'mfa')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'That didn’t work — please try again.')
      setView('expired')
    }
  }

  async function resend() {
    setResent(false)
    try {
      // Answers stay on the server for 24 hours, so the address alone is enough.
      await requestMagicLink(email.trim(), null)
      setResent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send that — try again in a moment.')
    }
  }

  if (view === 'loading' || view === 'busy') {
    return <AuthShell title="One moment" sub="Keeping your result..." />
  }

  if (view === 'continue' && token) {
    return (
      <AuthShell
        title="Keep your result"
        sub="Press Continue to save your readiness result and open your account."
      >
        <button type="button" className="lk-btn" onClick={() => redeem({ token })}>
          Continue
        </button>
      </AuthShell>
    )
  }

  if (view === 'saved' && snapshot) {
    return (
      <AuthShell
        title="Your result is saved"
        sub={`Readiness snapshot, ${fmtDate(snapshot.saved_at)}`}
      >
        <p className="lk-hint lk-center" style={{ fontSize: 28, fontWeight: 700 }}>
          {snapshot.score === null ? 'No score' : `${snapshot.score} / 100`}
        </p>
        <ul className="lk-hint" style={{ listStyle: 'none', padding: 0 }}>
          {snapshot.components
            .filter((c) => c.score !== null)
            .map((c) => (
              <li key={c.key}>
                {c.label}: {c.score}/100
              </li>
            ))}
        </ul>
        <p className="lk-hint lk-center">
          This is an estimate from six answers. Add what you have on file to make it more accurate.
        </p>
        <Link href="/" className="lk-btn">
          Open LifeKeel
        </Link>
      </AuthShell>
    )
  }

  if (view === 'mfa' && snapshot) {
    return (
      <AuthShell
        title="Your result is saved"
        sub="This account uses two-step sign-in, so we saved the result but did not sign you in."
      >
        <Link href="/login" className="lk-btn">
          Sign in
        </Link>
      </AuthShell>
    )
  }

  // 'code' (no token in the URL) and 'expired' share the code form.
  return (
    <AuthShell
      title={view === 'expired' ? 'Link or code didn’t work' : 'Enter your code'}
      sub={
        view === 'expired'
          ? 'Links and codes work for 30 minutes and only once. Enter the code from the email, or send a new link.'
          : 'Opened the email on another device? Enter the 6-digit code it contains.'
      }
    >
      {error && (
        <p role="status" aria-live="polite" className="lk-err">
          {error}
        </p>
      )}
      <label className="lk-label" htmlFor="kr-email">
        Email address
      </label>
      <input
        id="kr-email"
        type="email"
        autoComplete="email"
        className="lk-input"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label className="lk-label" htmlFor="kr-code">
        6-digit code
      </label>
      <input
        id="kr-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className="lk-input"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      <button
        type="button"
        className="lk-btn"
        disabled={!email.trim() || code.length !== 6}
        onClick={() => redeem({ email: email.trim(), code })}
      >
        Continue
      </button>
      <button
        type="button"
        className="lk-btn lk-btn-quiet"
        disabled={!email.trim()}
        onClick={resend}
      >
        Send me a new link
      </button>
      {resent && (
        <p role="status" aria-live="polite" className="lk-hint lk-ok lk-center">
          If that address has a pending result, a new link is on its way.
        </p>
      )}
      <Link href="/readiness" className="lk-btn lk-btn-quiet">
        Retake the check
      </Link>
    </AuthShell>
  )
}
