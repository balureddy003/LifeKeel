'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, Heart, Wallet, Target, PiggyBank, FileLock2, HelpCircle, Bot, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, PageHeader, ScoreRing, Money } from '@/components/Glass'
import { useFamilyHealthDomains, type HealthDomain } from '@/lib/useFamilyData'
import { learnMoreHref } from '@/lib/detector-content'
import { RESOLVED_INSIGHT_STATES, type FamilyInsight } from '@/lib/api'

// Domain accent colors come from the semantic vars (same hues) rather
// than the pastel literals — they're used as label text and icon colors
// here, which would fail WCAG AA on the light theme's background.
const DOMAIN_META: Record<HealthDomain, { label: string; icon: LucideIcon; color: string; description: string }> = {
  protection: {
    label: 'Protection',
    icon: Heart,
    color: 'rgb(var(--danger))',
    description: 'Life insurance, income protection, and coverage for your family.',
  },
  wealth: {
    label: 'Wealth',
    icon: Wallet,
    color: 'rgb(var(--warning))',
    description: 'Retirement savings and long-term wealth building.',
  },
  goals: {
    label: 'Goals',
    icon: Target,
    color: 'rgb(var(--success))',
    description: "Education funding and your family's savings goals.",
  },
  savings: {
    label: 'Savings',
    icon: PiggyBank,
    color: 'rgb(var(--info))',
    description: 'Emergency fund adequacy and short-term liquidity.',
  },
  estate: {
    label: 'Estate',
    icon: FileLock2,
    color: 'rgb(var(--family-400))',
    description: 'Wills, power of attorney, and estate documents held in your vault.',
  },
}

function isHealthDomain(value: string): value is HealthDomain {
  return value === 'protection' || value === 'wealth' || value === 'goals' || value === 'savings' || value === 'estate'
}

// insight.hypothesis is the detector rule's internal snake_case id (e.g.
// "life_insurance_below_household_needs"), not display text — Studio's
// insight-title.ts hits the same thing and title-cases it as a fallback
// rather than showing the raw id. Same fix here, scoped to this one render
// site rather than changing what the shared engine populates the field
// with (hypothesis is used as a stable value elsewhere, not just display).
function readableHypothesis(hypothesis: string): string {
  return hypothesis.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// PRD-107: resolved insights (the condition no longer holds, auto-retracted
// by a later evaluation) get their own quiet section rather than sitting
// undifferentiated among open ones. Insights a human already actioned —
// approved/completed/dismissed/archived — drop out of the list entirely
// (they're not "now covered", they're handled); the readiness score's
// RESOLVED_INSIGHT_STATES is the same boundary. Exported so the split logic
// is testable without rendering the component.
export function splitInsightsByResolution(insights: FamilyInsight[]): {
  open: FamilyInsight[]
  resolved: FamilyInsight[]
} {
  return {
    open: insights.filter((i) => !RESOLVED_INSIGHT_STATES.includes(i.state)),
    resolved: insights.filter((i) => i.state === 'resolved'),
  }
}

export default function HealthDomainClient() {
  const params = useParams<{ domain: string }>()
  const { domains, loading } = useFamilyHealthDomains()

  if (!isHealthDomain(params.domain)) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
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
  const { open: openInsights, resolved: resolvedInsights } = splitInsightsByResolution(domain.insights)

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
              {!loading && domain.gated ? (
                <div className="flex items-center gap-1.5 text-xs text-ink-tertiary mb-1">
                  <AlertTriangle size={12} />
                  <span>Visible to adult family members only</span>
                </div>
              ) : !loading && !domain.hasLiveData ? (
                <div className="flex items-center gap-1.5 text-xs text-warning mb-1">
                  <AlertTriangle size={12} />
                  <span>Sample score — connect your data for a real one</span>
                </div>
              ) : null}
              {!loading && domain.hasLiveData && !domain.gated && (
                <div className="flex items-center gap-1.5 text-xs text-success mb-1">
                  <CheckCircle2 size={12} />
                  <span>Based on your family's data</span>
                </div>
              )}
              <p className="text-xs text-ink-tertiary leading-relaxed">{meta.description}</p>
              {domain.detail && (
                <p className="text-xs text-ink-secondary leading-relaxed mt-1.5">{domain.detail}</p>
              )}
              {domain.caption && (
                <p className="text-footnote text-ink-tertiary mt-1.5">{domain.caption}</p>
              )}
            </div>
          </div>

          {/* G13 explainability — the actual profile figures the score
              was computed from, so "why this number" shows real inputs
              rather than just the conclusion. */}
          {!loading && domain.drivers && domain.drivers.length > 0 && (
            <dl className="mt-4 pt-4 border-t border-tint/[0.06] grid grid-cols-2 gap-x-3 gap-y-1.5">
              {domain.drivers.map((d) => (
                <div key={d.label} className="contents">
                  <dt className="text-xs text-ink-tertiary">{d.label}</dt>
                  <dd className="text-xs text-ink-secondary font-medium text-right">
                    {d.value_minor !== undefined
                      ? <Money value={`£${Math.round(d.value_minor / 100).toLocaleString('en-GB')}`} />
                      : d.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
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

        {!loading && openInsights.length === 0 && (
          <GlassCard className="p-5">
            <p className="text-sm text-ink-secondary leading-relaxed">
              {domain.hasLiveData
                ? `No gaps found in your ${meta.label.toLowerCase()} data — nice work.`
                : `No ${meta.label.toLowerCase()} insights yet. Once you connect more data, this section will show specific findings about your family's ${meta.label.toLowerCase()}.`}
            </p>
          </GlassCard>
        )}

        {!loading && openInsights.map((insight, i) => (
          <motion.div
            key={insight.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <GlassCard className="p-4 mb-2">
              <div className="text-sm font-semibold text-ink-primary mb-1">{readableHypothesis(insight.hypothesis)}</div>
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
              <div className="flex items-center gap-4 mt-2">
                {learnMoreHref(insight.rule_id) && (
                  <Link href={learnMoreHref(insight.rule_id)!} className="text-xs text-family-400 font-semibold inline-block">
                    Learn more →
                  </Link>
                )}
                {/* Act-layer gate (remediation item 25): approving runs the
                    insight's actions — the gate screen shows what each one
                    actually does before the human confirms. */}
                <Link href={`/insights/${insight.id}`} className="text-xs text-family-400 font-semibold inline-block">
                  Review & approve →
                </Link>
              </div>
            </GlassCard>
          </motion.div>
        ))}

        {!loading && resolvedInsights.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-tertiary mb-3 px-1">
              <CheckCircle2 size={16} className="text-success" />
              Resolved
            </div>
            {resolvedInsights.map((insight) => (
              <GlassCard key={insight.id} className="p-4 mb-2 opacity-70">
                <p className="text-sm text-ink-secondary">
                  {readableHypothesis(insight.hypothesis)} — this is now covered.
                </p>
              </GlassCard>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}
