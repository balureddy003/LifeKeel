'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { requestPasswordReset } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { AuthShell } from '@/components/landing/AuthShell'

export default function RequestPasswordResetPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Submitting swaps the entire page content — form to a "Check your
  // email" confirmation screen — with nothing else on the page for a
  // screen-reader user to anchor on (the button they just activated is
  // gone along with everything around it). Moving focus to the new
  // heading gives both an announcement and a stable landmark, the same
  // pattern used for financial-profile's step transitions.
  const sentHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (sent) sentHeadingRef.current?.focus()
  }, [sent])

  const handleSubmit = async () => {
    if (loading) return
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    haptic('light')
    setLoading(true)
    setError(null)
    try {
      await requestPasswordReset(email.trim())
      haptic('success')
      setSent(true)
    } catch (err) {
      haptic('warning')
      setError(
        err instanceof Error
          ? err.message
          : "That didn't work — your password is unchanged. Try again in a moment.",
      )
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        sub={`If an account exists for ${email}, we've sent a link to reset your password. It expires in 1 hour.`}
        headingRef={sentHeadingRef}
      >
        <Link href="/login" className="lk-btn lk-btn-quiet">
          Back to sign in
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password" sub="Enter your email and we'll send you a reset link">
      <form
        className="lk-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        <div className="lk-field">
          <label htmlFor="reset-email">Email address</label>
          <input
            id="reset-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="lk-input"
            aria-invalid={error ? true : undefined}
            aria-describedby="reset-error"
          />
        </div>
        <div id="reset-error" role="alert" className="lk-err">
          {error ?? ''}
        </div>
        <button type="submit" className="lk-btn" disabled={loading}>
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
      </form>

      <Link href="/login" className="lk-textlink lk-textlink-muted">
        Back to sign in
      </Link>
    </AuthShell>
  )
}
