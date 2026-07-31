'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, Heart, Wallet, Target, PiggyBank, HelpCircle, Bot, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, PageHeader, ScoreRing } from '@/components/Glass'
import { useFamilyHealthDomains, type HealthDomain } from '@/lib/useFamilyData'

const DOMAIN_META: Record<HealthDomain, { label: string; icon: LucideIcon; color: string; description: string }> = {
  protection: {
    label: 'Protection',
    icon: Heart,
    color: '#f87171',
    description: 'Life insurance, income protection, and coverage for your family.',
  },
  wealth: {
    label: 'Wealth',
    icon: Wallet,
    color: '#fbbf24',
    description: 'Retirement savings and long-term wealth building.',
  },
  goals: {
    label: 'Goals',
    icon: Target,
    color: '#4ade80',
    description: "Education funding and your family's savings goals.",
  },
  savings: {
    label: 'Savings',
    icon: PiggyBank,
    color: '#60a5fa',
    description: 'Emergency fund adequacy and short-term liquidity.',
  },
}

function isHealthDomain(value: string): value is HealthDomain {
  return value === 'protection' || value === 'wealth' || value === 'goals' || value === 'savings'
}

export default function HealthDomainPage() {
  const params = useParams<{ domain: string }>()
  const { domains, loading } = useFamilyHealthDomains()

  if (!isHealthDomain(params.domain)) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Unknown health area</p>
        <Link href="/" className="text-family-400 font-semibold mt-4 inline-block flex items-center gap-1 justify-center">
          <ArrowLeft size={14} /> Back to Home
        </Link>
      </div>
    )
  }

  const meta = DOMAIN_META[params.domain]
  const domain = domains[params.domain]
  const Icon = meta.icon

  return (
    <div className="px-5 pt-2 space-y-5">
      <PageHeader title={meta.label} backHref="/" subtitle={meta.description} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassCard className="p-5">
          <div className="flex items-center gap-4">
            <ScoreRing score={loading ? 0 : domain.score} size={96} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} color={meta.color} />
                <span className="text-sm font-semibold" style={{ color: meta.color }}>
                  {meta.label}
                </span>
              </div>
              {!loading && !domain.hasLiveData && (
                <div className="flex items-center gap-1.5 text-xs text-warning mb-1">
                  <AlertTriangle size={12} />
                  <span>Sample score — connect your data for a real one</span>
                </div>
              )}
              {!loading && domain.hasLiveData && (
                <div className="flex items-center gap-1.5 text-xs text-success mb-1">
                  <CheckCircle2 size={12} />
                  <span>Based on your family's data</span>
                </div>
              )}
              <p className="text-xs text-ink-tertiary leading-relaxed">{meta.description}</p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
          <Bot size={16} className="text-family-400" />
          Insights
        </div>

        {loading && (
          <GlassCard className="p-5">
            <div className="shimmer h-4 rounded mb-2" />
            <div className="shimmer h-4 rounded w-2/3" />
          </GlassCard>
        )}

        {!loading && domain.insights.length === 0 && (
          <GlassCard className="p-5">
            <p className="text-sm text-ink-secondary leading-relaxed">
              No {meta.label.toLowerCase()} insights yet. Once you connect more data, this section will
              show specific findings about your family's {meta.label.toLowerCase()}.
            </p>
          </GlassCard>
        )}

        {!loading && domain.insights.map((insight, i) => (
          <motion.div
            key={insight.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <GlassCard className="p-4 mb-2">
              <div className="text-sm font-semibold text-ink-primary mb-1">{insight.hypothesis}</div>
              <p className="text-sm text-ink-secondary leading-relaxed mb-2">{insight.reasoning}</p>
              {insight.actions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {insight.actions.map((action) => (
                    <span key={action} className="glass rounded-full px-3 py-1 text-xs text-ink-secondary">
                      {action}
                    </span>
                  ))}
                </div>
              )}
            </GlassCard>
          </motion.div>
        ))}
      </motion.div>

      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-ink-tertiary leading-relaxed">
          This is informational only — please consult a qualified professional before making financial decisions.
        </p>
      </div>
    </div>
  )
}
