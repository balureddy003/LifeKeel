'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Mail, CheckCircle2, ArrowLeft } from 'lucide-react'
import { requestPasswordReset } from '@/lib/api'
import { haptic } from '@/lib/haptics'

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
    if (!email.trim()) return
    haptic('light')
    setLoading(true)
    setError(null)
    try {
      await requestPasswordReset(email.trim())
      haptic('success')
      setSent(true)
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : "That didn't work — your password is unchanged. Try again in a moment.")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-16 h-16 rounded-3xl bg-success/10 border border-success/20 flex items-center justify-center mb-4"
        >
          <CheckCircle2 size={32} className="text-success" />
        </motion.div>
        <h1 ref={sentHeadingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight mb-2 outline-none bg-gradient-to-r from-family-400 to-family-500 bg-clip-text text-transparent">Check your email</h1>
        <p className="text-sm text-ink-tertiary max-w-xs mb-8">
          If an account exists for <span className="text-ink-primary font-medium">{email}</span>, we&apos;ve sent a link to reset your password. It expires in 1 hour.
        </p>
        <Link href="/login" className="text-sm text-family-400 font-semibold flex items-center gap-1">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-3 mx-auto">
          <Mail size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight bg-gradient-to-r from-family-400 to-family-500 bg-clip-text text-transparent">Reset your password</h1>
        <p className="text-sm text-ink-tertiary mt-1">Enter your email and we&apos;ll send you a reset link</p>
      </div>

      <div className="space-y-3 mb-6">
        <label htmlFor="reset-email" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Email address</div>
          <input
            id="reset-email"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="email"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger text-center mb-4">{error}</p>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSubmit}
        disabled={!email.trim() || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity mb-6"
      >
        {loading ? 'Sending...' : 'Send reset link'}
      </motion.button>

      <Link href="/login" className="text-sm text-ink-tertiary text-center flex items-center justify-center gap-1">
        <ArrowLeft size={14} /> Back to sign in
      </Link>
    </div>
  )
}
