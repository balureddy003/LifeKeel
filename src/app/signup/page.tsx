'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Network } from 'lucide-react'
import { GoogleIcon } from '@/components/GoogleIcon'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'

export default function SignUpPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signUp, signInWithProvider } = useAuth()
  const router = useRouter()

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || password.length < 8) return
    setLoading(true)
    setError(null)
    try {
      await signUp(name, email, password)
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
        <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-3">
          <Network size={32} className="text-family-400" />
        </div>
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
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-ink-tertiary">or use email</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <div className="space-y-3 mb-6">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
        />
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
        />
        <input
          type="password"
          placeholder="Password (min. 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
        />
      </div>

      {error && (
        <p className="text-sm text-danger text-center mb-4">{error}</p>
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
