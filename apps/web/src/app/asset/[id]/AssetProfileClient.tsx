'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, HelpCircle, House, TrendingUp, Landmark, Loader2, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader, Money, GlassCard } from '@/components/Glass'
import { fetchFinancialProfile, type FinancialProfile } from '@/lib/api'

const ASSET_META: Record<string, { label: string; icon: LucideIcon }> = {
  home: { label: 'Family Home', icon: House },
  investments: { label: 'Investments', icon: TrendingUp },
  pension: { label: 'Pension', icon: Landmark },
}

function money(minor: number): string {
  return `$${Math.round(minor / 100).toLocaleString()}`
}

export default function AssetProfileClient() {
  const params = useParams<{ id: string }>()
  const meta = ASSET_META[params.id]
  const [profile, setProfile] = useState<FinancialProfile | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [])

  if (!meta) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-4 mx-auto">
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
        <GlassCard className="p-5 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-ink-tertiary" />
        </GlassCard>
      ) : params.id === 'home' ? (
        <HomeDetail profile={profile} icon={Icon} />
      ) : params.id === 'pension' || params.id === 'investments' ? (
        <RetirementDetail profile={profile} icon={Icon} label={meta.label} />
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

function HomeDetail({ profile, icon: Icon }: { profile: FinancialProfile | null; icon: LucideIcon }) {
  if (!profile) {
    return <NoDataPrompt text="Add your mortgage details in your Financial Profile to see them here." />
  }
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className="text-ink-secondary" />
        <span className="text-sm font-semibold text-ink-secondary">Mortgage Outstanding</span>
      </div>
      <Money value={money(profile.household.mortgage_outstanding_minor)} className="text-2xl font-bold text-family-400" />
      <p className="text-xs text-ink-tertiary mt-3 pt-3 border-t border-haze/20">
        We don&apos;t track your home&apos;s market value or ownership split yet — only what you&apos;ve
        entered in your Financial Profile.
      </p>
    </div>
  )
}

function RetirementDetail({ profile, icon: Icon, label }: { profile: FinancialProfile | null; icon: LucideIcon; label: string }) {
  if (!profile) {
    return <NoDataPrompt text="Add your pension balance and contributions in your Financial Profile to see them here." />
  }
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className="text-ink-secondary" />
        <span className="text-sm font-semibold text-ink-secondary">Pension Balance</span>
      </div>
      <Money value={money(profile.retirement.pension_balance_minor)} className="text-2xl font-bold text-family-400" />

      <div className="mt-4 pt-4 border-t border-haze/20 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-ink-tertiary mb-1">Monthly Contribution</div>
          <Money value={money(profile.retirement.monthly_contribution_minor)} className="text-lg font-semibold text-ink-primary" />
        </div>
        <div>
          <div className="text-xs text-ink-tertiary mb-1">Target Retirement Age</div>
          <span className="text-lg font-semibold text-ink-primary">{profile.retirement.target_retirement_age}</span>
        </div>
      </div>
      <p className="text-xs text-ink-tertiary mt-3 pt-3 border-t border-haze/20">
        {label} isn&apos;t tracked as a separate account yet — this reflects your pension figures from
        your Financial Profile.
      </p>
    </div>
  )
}
