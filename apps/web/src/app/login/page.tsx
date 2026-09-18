'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Network } from 'lucide-react'
import { GoogleIcon } from '@/components/GoogleIcon'
import { PasswordInput } from '@/components/PasswordInput'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signIn, signInWithProvider } = useAuth()
  const router = useRouter()

  const handleSignIn = async () => {
    if (!email.trim() || !password) return
    setLoading(true)
    setError(null)
    try {
      await signIn(email, password)
      haptic('success')
      router.push('/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    try {
      await signInWithProvider('google')
      haptic('medium')
      router.push('/')
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
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="text-sm text-ink-tertiary mt-1">Sign in to your family</p>
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
        <label htmlFor="login-email" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Email address</div>
          <input
            id="login-email"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
            autoComplete="email"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <div>
          <label htmlFor="login-password" className="block text-xs text-ink-tertiary mb-1.5 px-1">Password</label>
          <PasswordInput
            id="login-password"
            placeholder="Password"
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
            autoComplete="current-password"
          />
        </div>
      </div>

      <Link
        href="/reset-password"
        className="text-sm text-family-400 font-semibold text-center mb-6 -mt-2"
        onClick={() => haptic('light')}
      >
        Forgot password?
      </Link>

      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger text-center mb-4">{error}</p>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSignIn}
        disabled={!email.trim() || !password || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </motion.button>
    </div>
  )
}
