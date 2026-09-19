'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Lock, CheckCircle2, AlertCircle } from 'lucide-react'
import { PasswordInput } from '@/components/PasswordInput'
import { confirmPasswordReset } from '@/lib/api'
import { haptic } from '@/lib/haptics'

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
      setError(err instanceof Error ? err.message : "That didn't work — your password is unchanged. Try again in a moment.")
    } finally {
      setLoading(false)
    }
  }

  if (!checked) {
    return null
  }

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-4">
          <AlertCircle size={32} className="text-danger" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Invalid reset link</h1>
        <p className="text-sm text-ink-tertiary max-w-xs mb-8">
          This link is missing its reset token. Request a new one to continue.
        </p>
        <Link href="/reset-password" className="text-sm text-family-400 font-semibold">
          Request a new link
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-16 h-16 rounded-3xl bg-success/10 border border-success/20 flex items-center justify-center mb-4"
        >
          <CheckCircle2 size={32} className="text-success" />
        </motion.div>
        <h1 className="text-2xl font-bold mb-2">Password updated</h1>
        <p className="text-sm text-ink-tertiary">Taking you to sign in...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-3 mx-auto">
          <Lock size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-bold">Set a new password</h1>
        <p className="text-sm text-ink-tertiary mt-1">Must be at least 8 characters</p>
      </div>

      <div className="space-y-3 mb-6">
        <div>
          <label htmlFor="confirm-new-password" className="block text-xs text-ink-tertiary mb-1.5 px-1">New password</label>
          <PasswordInput
            id="confirm-new-password"
            placeholder="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label htmlFor="confirm-new-password-repeat" className="block text-xs text-ink-tertiary mb-1.5 px-1">Confirm new password</label>
          <PasswordInput
            id="confirm-new-password-repeat"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="new-password"
          />
        </div>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger text-center mb-4">{error}</p>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSubmit}
        disabled={password.length < 8 || !confirmPassword || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Updating...' : 'Update password'}
      </motion.button>
    </div>
  )
}
