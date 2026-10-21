'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRouteParam } from '@/lib/useRouteParam'
import Link from 'next/link'
import { ArrowLeft, HelpCircle, House, Landmark, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader, Money, Skeleton } from '@/components/Glass'
import { fetchFinancialProfile, type FinancialProfile } from '@/lib/api'

const ASSET_META: Record<string, { label: string; icon: LucideIcon }> = {
  home: { label: 'Family Home', icon: House },
  pension: { label: 'Pension', icon: Landmark },
}

function money(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString()}`
}

export default function AssetProfileClient() {
  const assetId = useRouteParam('/asset')
  const router = useRouter()
  const meta = assetId ? ASSET_META[assetId] : undefined
  const [profile, setProfile] = useState<FinancialProfile | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((p) => {
      if (!cancelled) setProfile(p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 'investments' was removed as a distinct asset (see assets-data.ts) — it
  // showed the exact same pension-backed data as /asset/pension under a
  // different label. A redirect (not a 404) so a stale bookmark or old
  // in-app link still lands somewhere real instead of a dead end.
  useEffect(() => {
    if (assetId === 'investments') router.replace('/asset/pension')
  }, [assetId, router])

  if (assetId === 'investments') return null

  // assetId stays undefined until the real URL segment is resolved
  // post-mount (static export — see useRouteParam); show a shimmer rather
  // than a false "Asset not found" for that first render.
  if (assetId === undefined) {
    return (
      <div className="px-5 pt-8 space-y-3">
        <div className="shimmer h-24 rounded-2xl" />
        <div className="shimmer h-24 rounded-2xl" />
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Asset not found</p>
        <Link href="/family" className="btn-secondary mt-4 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to Family
        </Link>
      </div>
    )
  }

  const Icon = meta.icon

  return (
    <div className="px-5 pt-2 space-y-5 animate-fade-in">
      <PageHeader title={meta.label} backHref="/family" />

      {profile === undefined ? (
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Icon size={18} className="text-ink-secondary" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="h-7 w-40 mt-1" />
          <div className="mt-3 pt-3 border-t border-haze/20 space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ) : assetId === 'home' ? (
        <HomeDetail profile={profile} icon={Icon} />
      ) : assetId === 'pension' ? (
        <RetirementDetail profile={profile} icon={Icon} />
      ) : null}
    </div>
  )
}

function NoDataPrompt({ text }: { text: string }) {
  return (
    <Link href="/financial-profile" className="card flex items-center gap-3 active:opacity-80">
      <div className="flex-1">
        <div className="text-sm font-semibold text-ink-primary">Not added yet</div>
        <p className="text-xs text-ink-tertiary mt-0.5">{text}</p>
      </div>
      <ChevronRight size={16} className="text-ink-tertiary flex-shrink-0" />
    </Link>
  )
}

function HomeDetail({
  profile,
  icon: Icon,
}: {
  profile: FinancialProfile | null
  icon: LucideIcon
}) {
  if (!profile) {
    return (
      <NoDataPrompt text="Add your mortgage details in your Financial Profile to see them here." />
    )
  }
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className="text-ink-secondary" />
        <span className="text-sm font-semibold text-ink-secondary">Mortgage Outstanding</span>
      </div>
      <Money
        value={money(profile.household.mortgage_outstanding_minor)}
        className="text-2xl font-bold text-family-400"
      />
      <p className="text-xs text-ink-tertiary mt-3 pt-3 border-t border-haze/20">
        We don&apos;t track your home&apos;s market value or ownership split yet — only what
        you&apos;ve entered in your Financial Profile.
      </p>
    </div>
  )
}

function RetirementDetail({
  profile,
  icon: Icon,
}: {
  profile: FinancialProfile | null
  icon: LucideIcon
}) {
  if (!profile) {
    return (
      <NoDataPrompt text="Add your pension balance and contributions in your Financial Profile to see them here." />
    )
  }
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className="text-ink-secondary" />
        <span className="text-sm font-semibold text-ink-secondary">Pension Balance</span>
      </div>
      <Money
        value={money(profile.retirement.pension_balance_minor)}
        className="text-2xl font-bold text-family-400"
      />

      <div className="mt-4 pt-4 border-t border-haze/20 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-ink-tertiary mb-1">Monthly Contribution</div>
          <Money
            value={money(profile.retirement.monthly_contribution_minor)}
            className="text-lg font-semibold text-ink-primary"
          />
        </div>
        <div>
          <div className="text-xs text-ink-tertiary mb-1">Target Retirement Age</div>
          <span className="text-lg font-semibold text-ink-primary">
            {profile.retirement.target_retirement_age}
          </span>
        </div>
      </div>
      <p className="text-xs text-ink-tertiary mt-3 pt-3 border-t border-haze/20">
        These figures come from your Financial Profile.
      </p>
    </div>
  )
}
