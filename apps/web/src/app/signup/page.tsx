'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { GoogleIcon } from '@/components/GoogleIcon'
import { PasswordInput } from '@/components/PasswordInput'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'

export default function SignUpPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refCode, setRefCode] = useState<string | undefined>(undefined)
  const { signUp, signInWithProvider } = useAuth()
  const router = useRouter()

  // PRD-112: carried through from a friend's referral link
  // (/signup?ref=<code>), same window.location.search convention as
  // /life-events's own ?type=.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref) setRefCode(ref)
  }, [])

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || password.length < 8) return
    setLoading(true)
    setError(null)
    try {
      await signUp(name, email, password, refCode)
      haptic('success')
      track('signup_completed', { method: 'password' })
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
      router.push('/family-setup')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="text-center mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- matches MarketingLanding.tsx's own /icon.svg usage */}
        <img src="/icon.svg" alt="" width={64} height={64} className="rounded-3xl mx-auto mb-3" />
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="text-sm text-ink-tertiary mt-1">Takes 30 seconds. No credit card needed.</p>
      </div>

      <div className="space-y-3 mb-6">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleGoogle}
          disabled={loading}
          className="w-full glass rounded-2xl py-4 font-semibold flex items-center justify-center gap-2"
        >
          <GoogleIcon size={20} /> Continue with Google
        </motion.button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-px bg-tint/10" />
        <span className="text-xs text-ink-tertiary">or use email</span>
        <div className="flex-1 h-px bg-tint/10" />
      </div>

      <div className="space-y-3 mb-6">
        <label htmlFor="signup-name" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Your name</div>
          <input
            id="signup-name"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
            autoComplete="name"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <label htmlFor="signup-email" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Email address</div>
          <input
            id="signup-email"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
            autoComplete="email"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <div>
          <label htmlFor="signup-password" className="block text-xs text-ink-tertiary mb-1.5 px-1">Password (min. 8 characters)</label>
          <PasswordInput
            id="signup-password"
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
            autoComplete="new-password"
          />
          {/* Live-verification finding: the only feedback for a too-short
              password was the Create Account button staying disabled, with
              no visible reason beyond the static label — easy to miss,
              especially for a first-time or less tech-savvy user. This
              updates as they type instead of only failing silently at
              submit. */}
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
        onClick={handleSignUp}
        disabled={!name.trim() || !email.trim() || password.length < 8 || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Creating...' : 'Create Account'}
      </motion.button>

      <p className="text-xs text-ink-tertiary text-center mt-4">
        By continuing, you agree to our{' '}
        <Link href="/terms" className="text-family-400 font-medium">Terms</Link> and{' '}
        <Link href="/privacy" className="text-family-400 font-medium">Privacy Policy</Link>.
      </p>
    </div>
  )
}
