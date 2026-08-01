'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Network, Apple } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'

export default function SignUpPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp, signInWithProvider } = useAuth()
  const router = useRouter()

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim()) return
    setLoading(true)
    haptic('success')
    await signUp(name, email)
    router.push('/family-setup')
  }

  const handleProvider = async (provider: 'apple' | 'google') => {
    setLoading(true)
    haptic('medium')
    await signInWithProvider(provider)
    router.push('/family-setup')
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
          onClick={() => handleProvider('apple')}
          disabled={loading}
          className="w-full glass rounded-2xl py-4 font-semibold flex items-center justify-center gap-2"
        >
          <Apple size={20} className="text-ink-secondary" /> Continue with Apple
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => handleProvider('google')}
          disabled={loading}
          className="w-full glass rounded-2xl py-4 font-semibold flex items-center justify-center gap-2"
        >
          <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white">G</span> Continue with Google
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
      </div>

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSignUp}
        disabled={!name.trim() || !email.trim() || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Creating...' : 'Create Account'}
      </motion.button>

      <p className="text-xs text-ink-tertiary text-center mt-4">
        By continuing, you agree to our Terms and Privacy Policy.
      </p>
    </div>
  )
}
