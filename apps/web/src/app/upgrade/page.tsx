'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton, Skeleton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import {
  fetchBillingSubscription,
  openBillingPortal,
  redeemPromoCode,
  startLifeKeelPlusCheckout,
  type BillingSubscription,
} from '@/lib/api'

// What Plus adds, briefs first: the free plan includes one brief, so more briefs is what a family pays for.
// Document and inbox reading stay as a convenience below, not the headline (PRD-222).
const BENEFITS = [
  'A brief for every situation you face, not just the first one',
  'Both adults see each answer, and Keel marks a brief when your figures change',
]
const ALSO_INCLUDED =
  'Also included: Keel reads a policy document or a financial email and lists what it found for you to confirm.'

export default function UpgradePage() {
  const [loading, setLoading] = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPlus, setIsPlus] = useState(false)
  const [sub, setSub] = useState<BillingSubscription | null>(null)
  const [banner, setBanner] = useState<'success' | 'canceled' | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<'month' | 'year'>('year')
  const [promoCode, setPromoCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [promoMessage, setPromoMessage] = useState<string | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)

  useEffect(() => {
    track('upgrade_page_view')
    const params = new URLSearchParams(window.location.search)
    const success = params.get('success') === 'true'
    if (success) setBanner('success')
    else if (params.get('canceled') === 'true') setBanner('canceled')

    const isActive = (sub: BillingSubscription | null) =>
      !!sub && sub.plan !== 'free' && sub.status !== 'canceled'

    let cancelled = false
    fetchBillingSubscription().then((s) => {
      if (cancelled) return
      setSub(s)
      setIsPlus(isActive(s))
      setLoading(false)
    })

    // Stripe's webhook can lag the checkout redirect by several seconds —
    // after a ?success=true return, keep polling briefly rather than
    // leaving "refresh if it doesn't update" on a page that never does.
    if (!success)
      return () => {
        cancelled = true
      }
    const startedAt = Date.now()
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > 30_000) {
        clearInterval(interval)
        return
      }
      const s = await fetchBillingSubscription()
      if (!cancelled && isActive(s)) {
        setSub(s)
        setIsPlus(true)
        clearInterval(interval)
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const handleUpgrade = async () => {
    haptic('light')
    track('upgrade_checkout_start')
    setCheckingOut(true)
    setError(null)
    try {
      const url = await startLifeKeelPlusCheckout(billingPeriod)
      window.location.href = url
    } catch (err) {
      haptic('warning')
      setError(
        err instanceof Error
          ? err.message
          : "Checkout didn't start — you haven't been charged anything. Try again in a moment.",
      )
      setCheckingOut(false)
    }
  }

  const handleManage = async () => {
    haptic('light')
    setOpeningPortal(true)
    setError(null)
    try {
      const url = await openBillingPortal(window.location.origin + '/upgrade')
      window.location.href = url
    } catch (err) {
      haptic('warning')
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't open subscription management. Try again in a moment.",
      )
      setOpeningPortal(false)
    }
  }

  const handleRedeem = async () => {
    const code = promoCode.trim()
    if (!code) return
    haptic('light')
    track('promo_redeem_attempt')
    setRedeeming(true)
    setPromoMessage(null)
    setPromoError(null)
    try {
      const result = await redeemPromoCode(code)
      haptic('success')
      track('promo_redeemed')
      setPromoMessage(`Code applied — ${result.grant_credits} credits added to your account.`)
      setPromoCode('')
    } catch (err) {
      haptic('warning')
      setPromoError(
        err instanceof Error ? err.message : "Couldn't redeem that code. Check it and try again.",
      )
    } finally {
      setRedeeming(false)
    }
  }

  if (loading) {
    return (
      <div className="px-5 pt-2 pb-10 space-y-5">
        <PageHeader
          title="Keel Plus"
          backHref="/settings"
          subtitle="The household record, kept current"
        />
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
      <PageHeader
        title="Keel Plus"
        backHref="/settings"
        subtitle="The household record, kept current"
      />

      {banner === 'success' && !isPlus && (
        <GlassCard className="p-4 border-success/20 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
          <p className="text-sm text-ink-secondary">
            Payment received — activating Keel Plus. This usually takes a few seconds and updates
            here automatically.
          </p>
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
            <h2 className="text-lg font-bold mb-1">You're on Keel Plus</h2>
            <p className="text-sm text-ink-tertiary">
              Household record, unlimited briefs, document reading, and inbox summaries are active
              on your account.
            </p>
            {sub?.subscription?.current_period_end && (
              <p className="text-xs text-ink-tertiary mt-2">
                {sub.subscription.cancel_at_period_end
                  ? `Cancels on ${new Date(sub.subscription.current_period_end * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} — Keel Plus stays active until then.`
                  : `Renews ${new Date(sub.subscription.current_period_end * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`}
              </p>
            )}
          </GlassCard>

          {error && (
            <p role="status" aria-live="polite" className="text-sm text-danger text-center mt-4">
              {error}
            </p>
          )}

          <GlassButton onClick={handleManage} disabled={openingPortal} className="mt-4">
            {openingPortal ? <Loader2 size={18} className="animate-spin" /> : 'Manage subscription'}
          </GlassButton>
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
                <li
                  key={b}
                  className="flex items-start gap-2 text-sm text-ink-secondary leading-relaxed"
                >
                  <CheckCircle2 size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-tertiary leading-relaxed">{ALSO_INCLUDED}</p>
          </GlassCard>

          <div role="radiogroup" aria-label="Billing period" className="grid grid-cols-2 gap-3">
            {(
              [
                {
                  value: 'year',
                  title: 'Yearly',
                  price: '£59.99',
                  per: 'a year',
                  note: 'Cancel anytime',
                },
                {
                  value: 'month',
                  title: 'Monthly',
                  price: '£7.99',
                  per: 'a month',
                  note: 'Cancel anytime',
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={billingPeriod === opt.value}
                onClick={() => {
                  haptic('light')
                  setBillingPeriod(opt.value)
                }}
                className={`rounded-2xl p-4 text-left border transition-colors ${
                  billingPeriod === opt.value
                    ? 'border-family-500/50 bg-family-500/[0.08]'
                    : 'border-tint/[0.08] bg-tint/[0.02]'
                }`}
              >
                <div className="text-xs font-semibold text-ink-tertiary">{opt.title}</div>
                <div className="text-2xl font-bold mt-1">
                  {opt.price}
                  <span className="text-xs font-medium text-ink-tertiary"> {opt.per}</span>
                </div>
                <div className="text-[11px] text-ink-tertiary mt-1">{opt.note}</div>
              </button>
            ))}
          </div>

          {error && (
            <p role="status" aria-live="polite" className="text-sm text-danger text-center">
              {error}
            </p>
          )}

          <GlassButton onClick={handleUpgrade} disabled={checkingOut}>
            {checkingOut ? <Loader2 size={18} className="animate-spin" /> : 'Upgrade to Keel Plus'}
          </GlassButton>
        </>
      )}

      <GlassCard className="p-5">
        <label htmlFor="promo-code" className="text-sm font-semibold text-ink-secondary">
          Have a promo code?
        </label>
        <div className="flex gap-2 mt-2">
          <input
            id="promo-code"
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder="Enter code"
            autoComplete="off"
            autoCapitalize="characters"
            className="flex-1 min-w-0 rounded-xl bg-tint/[0.04] border border-tint/[0.08] px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-family-500/40"
          />
          <GlassButton
            onClick={handleRedeem}
            disabled={redeeming || promoCode.trim().length === 0}
            className="px-4 py-2 text-sm w-auto"
          >
            {redeeming ? <Loader2 size={16} className="animate-spin" /> : 'Apply'}
          </GlassButton>
        </div>
        {promoMessage && (
          <p role="status" className="text-sm text-success mt-2">
            {promoMessage}
          </p>
        )}
        {promoError && (
          <p role="status" className="text-sm text-danger mt-2">
            {promoError}
          </p>
        )}
      </GlassCard>

      <p className="text-xs text-ink-tertiary text-center leading-relaxed">
        Your first brief and storing documents are always free. This upgrade covers the household
        record — unlimited briefs and the AI reading step.
      </p>
    </div>
  )
}
