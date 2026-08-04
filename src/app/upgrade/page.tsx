'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { fetchBillingSubscription, startTrellisPlusCheckout } from '@/lib/api'

const BENEFITS = [
  'AI reads your documents and pulls out the provider, policy number, amounts, and dates automatically',
  'AI-summarized inbox — financial emails read and explained in plain language',
  'Priority support',
]

export default function UpgradePage() {
  const [loading, setLoading] = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPlus, setIsPlus] = useState(false)
  const [banner, setBanner] = useState<'success' | 'canceled' | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') setBanner('success')
    else if (params.get('canceled') === 'true') setBanner('canceled')

    fetchBillingSubscription().then((sub) => {
      setIsPlus(!!sub && sub.plan !== 'free' && sub.status !== 'canceled')
      setLoading(false)
    })
  }, [])

  const handleUpgrade = async () => {
    haptic('light')
    setCheckingOut(true)
    setError(null)
    try {
      const url = await startTrellisPlusCheckout()
      window.location.href = url
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Could not start checkout. Please try again.')
      setCheckingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="px-5 pt-2">
        <PageHeader title="Trellis Plus" backHref="/settings" />
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-family-400" />
        </div>
      </div>
    )
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader title="Trellis Plus" backHref="/settings" subtitle="AI that does the reading for you" />

      {banner === 'success' && !isPlus && (
        <GlassCard className="p-4 border-success/20 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
          <p className="text-sm text-ink-secondary">Payment received — activating Trellis Plus. This can take a few seconds; refresh if it doesn't update.</p>
        </GlassCard>
      )}
      {banner === 'canceled' && (
        <GlassCard className="p-4 border-warning/20 flex items-start gap-3">
          <AlertCircle size={20} className="text-warning flex-shrink-0 mt-0.5" />
          <p className="text-sm text-ink-secondary">Checkout canceled — no charge was made.</p>
        </GlassCard>
      )}

      {isPlus ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-5 border-success/20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-success/10 border border-success/20 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={28} className="text-success" />
            </div>
            <h2 className="text-lg font-bold mb-1">You're on Trellis Plus</h2>
            <p className="text-sm text-ink-tertiary">AI document extraction and inbox summaries are active on your account.</p>
          </GlassCard>
        </motion.div>
      ) : (
        <>
          <GlassCard className="p-5 border-family-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={18} className="text-family-400" />
              <span className="text-sm font-semibold text-family-400">What you get</span>
            </div>
            <ul className="space-y-2.5">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-ink-secondary leading-relaxed">
                  <CheckCircle2 size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard className="p-5 text-center">
            <div className="text-3xl font-bold">
              £7.99<span className="text-base font-medium text-ink-tertiary">/month</span>
            </div>
            <p className="text-xs text-ink-tertiary mt-1">Cancel anytime</p>
          </GlassCard>

          {error && <p className="text-sm text-danger text-center">{error}</p>}

          <GlassButton onClick={handleUpgrade} disabled={checkingOut}>
            {checkingOut ? <Loader2 size={18} className="animate-spin" /> : 'Upgrade to Trellis Plus'}
          </GlassButton>
        </>
      )}

      <p className="text-xs text-ink-tertiary text-center leading-relaxed">
        Uploading and storing documents is always free. This upgrade covers the AI reading step only.
      </p>
    </div>
  )
}
