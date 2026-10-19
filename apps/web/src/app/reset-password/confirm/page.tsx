'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PasswordInput } from '@/components/PasswordInput'
import { confirmPasswordReset } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { AuthShell } from '@/components/landing/AuthShell'

export default function ConfirmPasswordResetPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Read the token from the query string on the client, same pattern as
  // /auth/callback — avoids the useSearchParams Suspense requirement that
  // static export otherwise needs. `token` stays null both before this runs
  // and when there's genuinely no token in the URL, so `checked` is what
  // actually distinguishes "still loading" from "checked, none found".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setToken(params.get('token'))
    setChecked(true)
  }, [])

  const handleSubmit = async () => {
    if (!token || password.length < 8) return
    if (password !== confirmPassword) {
      setError("Passwords don't match")
      return
    }
    haptic('light')
    setLoading(true)
    setError(null)
    try {
      await confirmPasswordReset(token, password)
      haptic('success')
      setDone(true)
      setTimeout(() => router.push('/login'), 2000)
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

  if (!checked) {
    return null
  }

  if (!token) {
    return (
      <AuthShell
        title="Invalid reset link"
        sub="This link is missing its reset token. Request a new one to continue."
      >
        <Link href="/reset-password" className="lk-btn">
          Request a new link
        </Link>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="Password updated" sub="Taking you to sign in...">
        <Link href="/login" className="lk-btn lk-btn-quiet">
          Sign in now
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Set a new password" sub="Must be at least 8 characters">
      <div className="lk-field">
        <label htmlFor="confirm-new-password">New password</label>
        <PasswordInput
          id="confirm-new-password"
          placeholder="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          inputClassName="lk-input"
          wrapperClassName="lk-pw"
          toggleClassName="lk-pw-toggle"
        />
      </div>
      <div className="lk-field">
        <label htmlFor="confirm-new-password-repeat">Confirm new password</label>
        <PasswordInput
          id="confirm-new-password-repeat"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          autoComplete="new-password"
          inputClassName="lk-input"
          wrapperClassName="lk-pw"
          toggleClassName="lk-pw-toggle"
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
        onClick={handleSubmit}
        disabled={password.length < 8 || !confirmPassword || loading}
      >
        {loading ? 'Updating...' : 'Update password'}
      </button>
    </AuthShell>
  )
}
