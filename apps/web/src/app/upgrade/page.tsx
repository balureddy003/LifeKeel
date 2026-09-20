'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, CheckCircle2, Loader2, AlertCircle, ScanLine } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton, Skeleton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { fetchBillingSubscription, startOakPlusCheckout, type BillingSubscription } from '@/lib/api'

const BENEFITS = [
  'AI reads your documents and pulls out the provider, policy number, amounts, and dates automatically',
  'AI-summarized inbox — financial emails read and explained in plain language',
  'Priority support',
]

const EXTRACTED_FIELDS = [
  // Live-verification finding: "AllState Insurance" truncated to
  // "AllState In..." in this chip's fixed width — the other three
  // example values are all short enough to stay on one line, so
  // shortening this illustrative (not real user data) example to match
  // keeps the same single-line rhythm across all four, instead of this
  // one alone needing to wrap.
  { label: 'Provider', value: 'Allstate' },
  { label: 'Policy Number', value: 'HO-88213-A' },
  { label: 'Amount', value: '£1,240/yr' },
  { label: 'Renews', value: 'Jun 14, 2027' },
]

// Show, don't tell — the benefits list said "AI reads your documents", so
// this mocks what that actually looks like before the user reads the copy.
function ExtractionPreview() {
  return (
    <GlassCard className="p-5 border-family-500/20 overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <ScanLine size={16} className="text-family-400" />
        <span className="text-sm font-semibold text-family-400">See it in action</span>
      </div>
      <div className="flex gap-4 items-start">
        <div className="relative w-20 h-28 rounded-lg bg-tint/[0.04] border border-tint/[0.08] flex-shrink-0 overflow-hidden p-2.5 space-y-2">
          <div className="h-1.5 w-3/4 rounded-full bg-tint/10" />
          <div className="h-1.5 w-full rounded-full bg-tint/10" />
          <div className="h-1.5 w-5/6 rounded-full bg-tint/10" />
          <div className="h-1.5 w-2/3 rounded-full bg-tint/10" />
          <div className="h-1.5 w-full rounded-full bg-tint/10" />
          <div className="h-1.5 w-4/5 rounded-full bg-tint/10" />
          <motion.div
            className="absolute left-0 right-0 h-10 pointer-events-none"
            style={{ background: 'linear-gradient(180deg, transparent, rgb(var(--family-accent) / 0.4), transparent)' }}
            initial={{ top: '-25%' }}
            animate={{ top: '115%' }}
            transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.4, ease: 'easeInOut' }}
          />
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          {EXTRACTED_FIELDS.map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.15, duration: 0.4 }}
              className="flex items-center gap-1.5 rounded-lg bg-family-500/[0.06] px-2.5 py-1.5"
            >
              <CheckCircle2 size={12} className="text-family-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-caption text-ink-tertiary leading-none mb-0.5">{f.label}</div>
                <div className="text-xs font-semibold text-ink-primary truncate">{f.value}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-tertiary mt-3 leading-relaxed">
        Illustrative example — upload a real document and Oak Plus extracts the details automatically.
      </p>
    </GlassCard>
  )
}

export default function UpgradePage() {
  const [loading, setLoading] = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPlus, setIsPlus] = useState(false)
  const [banner, setBanner] = useState<'success' | 'canceled' | null>(null)

  useEffect(() => {
    track('upgrade_page_view')
    const params = new URLSearchParams(window.location.search)
    const success = params.get('success') === 'true'
    if (success) setBanner('success')
    else if (params.get('canceled') === 'true') setBanner('canceled')

    const isActive = (sub: BillingSubscription | null) =>
      !!sub && sub.plan !== 'free' && sub.status !== 'canceled'

    let cancelled = false
    fetchBillingSubscription().then((sub) => {
      if (cancelled) return
      setIsPlus(isActive(sub))
      setLoading(false)
    })

    // Stripe's webhook can lag the checkout redirect by several seconds —
    // after a ?success=true return, keep polling briefly rather than
    // leaving "refresh if it doesn't update" on a page that never does.
    if (!success) return () => { cancelled = true }
    const startedAt = Date.now()
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > 30_000) {
        clearInterval(interval)
        return
      }
      const sub = await fetchBillingSubscription()
      if (!cancelled && isActive(sub)) {
        setIsPlus(true)
        clearInterval(interval)
      }
    }, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const handleUpgrade = async () => {
    haptic('light')
    track('upgrade_checkout_start')
    setCheckingOut(true)
    setError(null)
    try {
      const url = await startOakPlusCheckout()
      window.location.href = url
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : "Checkout didn't start — you haven't been charged anything. Try again in a moment.")
      setCheckingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="px-5 pt-2 pb-10 space-y-5">
        <PageHeader title="Oak Plus" backHref="/settings" subtitle="AI that does the reading for you" />
        <GlassCard className="p-5">
          <Skeleton className="h-4 w-28 mb-3" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <Skeleton className="h-4 w-4 rounded-full flex-shrink-0" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </GlassCard>
        <GlassCard className="p-5 text-center">
          <Skeleton className="h-8 w-28 mx-auto" />
          <Skeleton className="h-3 w-20 mx-auto mt-2" />
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader title="Oak Plus" backHref="/settings" subtitle="AI that does the reading for you" />

      {banner === 'success' && !isPlus && (
        <GlassCard className="p-4 border-success/20 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
          <p className="text-sm text-ink-secondary">Payment received — activating Oak Plus. This usually takes a few seconds and updates here automatically.</p>
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
            <h2 className="text-lg font-bold mb-1">You're on Oak Plus</h2>
            <p className="text-sm text-ink-tertiary">AI document extraction and inbox summaries are active on your account.</p>
          </GlassCard>
        </motion.div>
      ) : (
        <>
          <ExtractionPreview />

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

          {error && <p role="status" aria-live="polite" className="text-sm text-danger text-center">{error}</p>}

          <GlassButton onClick={handleUpgrade} disabled={checkingOut}>
            {checkingOut ? <Loader2 size={18} className="animate-spin" /> : 'Upgrade to Oak Plus'}
          </GlassButton>
        </>
      )}

      <p className="text-xs text-ink-tertiary text-center leading-relaxed">
        Uploading and storing documents is always free. This upgrade covers the AI reading step only.
      </p>
    </div>
  )
}
