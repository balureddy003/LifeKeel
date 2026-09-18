'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Users, Check, X, Clock } from 'lucide-react'
import { PasswordInput } from '@/components/PasswordInput'
import { joinFamily } from '@/lib/api'
import { haptic } from '@/lib/haptics'

// PRD-110: submitting this form never creates a login or grants any
// access by itself — it only creates a pending request the family's
// organizer has to explicitly approve. See docs/prd/110-family-sharing-secondary-user-access.md.
export default function InviteJoinClient() {
  const params = useParams<{ code: string }>()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ familyName: string } | null>(null)

  const canSubmit = name.trim() && email.trim() && password.length >= 8

  const handleSubmit = async () => {
    if (!canSubmit) return
    haptic('light')
    setLoading(true)
    setError(null)
    try {
      const result = await joinFamily(params.code, name.trim(), email.trim(), password)
      haptic('success')
      setSubmitted(result)
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : "Couldn't submit your request. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-4 mx-auto">
            <Clock size={32} className="text-family-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Waiting for approval</h1>
          <p className="text-sm text-ink-secondary leading-relaxed max-w-xs mx-auto">
            We've let {submitted.familyName} know you'd like to join. Once they approve your request, sign in
            with the email and password you just set.
          </p>
          <Link href="/login" className="inline-block mt-6 text-sm font-semibold text-family-400">
            Go to sign in
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-3 mx-auto">
          <Users size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-bold">Join your family on Oak</h1>
        <p className="text-sm text-ink-tertiary mt-1">
          The organizer will need to approve your request before you can sign in.
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <label htmlFor="invite-name" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Your name</div>
          <input
            id="invite-name"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="name"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <label htmlFor="invite-email" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Email address</div>
          <input
            id="invite-email"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="email"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <div>
          <label htmlFor="invite-password" className="block text-xs text-ink-tertiary mb-1.5 px-1">Password (min. 8 characters)</label>
          <PasswordInput
            id="invite-password"
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="new-password"
          />
          {password.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-1.5 mt-1.5 px-1 text-xs ${password.length >= 8 ? 'text-success' : 'text-ink-tertiary'}`}
            >
              {password.length >= 8 ? <Check size={12} /> : <X size={12} />}
              {password.length >= 8 ? 'Password length looks good' : `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed`}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger text-center mb-4">{error}</p>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSubmit}
        disabled={!canSubmit || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Submitting...' : 'Request to join'}
      </motion.button>

      <p className="text-xs text-ink-tertiary text-center mt-4">
        Already have an account?{' '}
        <Link href="/login" className="text-family-400 font-semibold">Sign in</Link>
      </p>
    </div>
  )
}
