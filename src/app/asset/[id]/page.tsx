'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, HelpCircle, House, TrendingUp, Landmark, Wallet, Users, ShieldCheck, Bot, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ASSETS } from '@/lib/assets-data'
import { PageHeader, Money, MoneyText } from '@/components/Glass'
import { haptic } from '@/lib/haptics'

const ASSET_ICONS: Record<string, LucideIcon> = {
  House,
  TrendingUp,
  Landmark,
}

export default function AssetProfilePage() {
  const params = useParams<{ id: string }>()
  const asset = ASSETS[params.id]

  if (!asset) {
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

  const Icon = ASSET_ICONS[asset.icon] ?? Wallet
  const equity = asset.mortgageRemaining !== undefined ? asset.marketValue - asset.mortgageRemaining : undefined

  return (
    <div className="px-5 pt-2 space-y-5 animate-fade-in">
      <PageHeader title={asset.label} backHref="/family" />

      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={18} className="text-ink-secondary" />
          <span className="text-sm font-semibold text-ink-secondary">Market Value</span>
        </div>
        <Money value={`$${asset.marketValue.toLocaleString()}`} className="text-2xl font-bold text-family-400" />

        {equity !== undefined && (
          <div className="mt-4 pt-4 border-t border-haze/20 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-ink-tertiary mb-1">Mortgage Remaining</div>
              <Money value={`$${asset.mortgageRemaining!.toLocaleString()}`} className="text-lg font-semibold text-ink-primary" />
            </div>
            <div>
              <div className="text-xs text-ink-tertiary mb-1">Equity</div>
              <Money value={`$${equity.toLocaleString()}`} className="text-lg font-semibold text-success" />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Users size={18} className="text-ink-secondary" />
          <span className="text-sm font-semibold text-ink-secondary">Owners</span>
        </div>
        <div className="flex items-center gap-4">
          {asset.owners.map((owner) => (
            <div key={owner.name} className="flex-1 text-center">
              <div className="text-lg font-bold text-family-400">{owner.share}%</div>
              <div className="text-xs text-ink-tertiary">{owner.name}</div>
            </div>
          ))}
        </div>
      </div>

      {asset.insurance && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={18} className="text-ink-secondary" />
            <span className="text-sm font-semibold text-ink-secondary">Insurance</span>
          </div>
          <div className="space-y-2">
            {asset.insurance.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <CheckCircle2 size={14} className={item.active ? 'text-success' : 'text-ink-tertiary'} />
                <span className="text-sm text-ink-primary">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Bot size={18} className="text-family-400" />
          <span className="text-sm font-semibold text-family-400">AI Insights</span>
        </div>
        <div className="space-y-2">
          {asset.insights.map((insight) => (
            <div key={insight.text} className="flex items-start gap-2">
              {insight.status === 'good' ? (
                <CheckCircle2 size={14} className="text-success flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
              )}
              <MoneyText text={insight.text} className="text-sm text-ink-secondary" />
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-tertiary mt-3 pt-3 border-t border-haze/20">
          This is informational only — please consult a qualified professional before making financial decisions.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {asset.actions.map((action) => (
          <button
            key={action}
            onClick={() => haptic('light')}
            className="btn-secondary text-sm"
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  )
}
