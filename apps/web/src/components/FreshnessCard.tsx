'use client'

/**
 * PRD-145 — checks that cannot run on current details, and why, in plain
 * words. Shown only when something is paused: a quiet month with every check
 * running needs no card. Names what is missing or old; never what to buy or do
 * about a product.
 */
import { GlassCard } from '@/components/Glass'
import type { FreshnessResponse } from '@/lib/api'

const FIELD_WORDS: Record<string, string> = {
  'household.monthly_salary_minor': 'monthly income',
  'household.annual_living_expenses_minor': 'yearly living costs',
  'emergency_fund.monthly_expenses_minor': 'monthly expenses',
  'retirement.current_age': 'current age',
  'retirement.target_retirement_age': 'target retirement age',
  'retirement.target_retirement_income_minor': 'target retirement income',
  'education_funds.target_savings_minor': 'education savings targets',
  'policies.renewal_date': 'a policy renewal date that has passed',
}

const word = (field: string) => FIELD_WORDS[field] ?? field.replace(/[._]/g, ' ')

export function FreshnessCard({ freshness }: { freshness: FreshnessResponse }) {
  const paused = freshness.detectors.filter((d) => d.state !== 'running')
  if (paused.length === 0) return null
  return (
    <GlassCard className="p-4 mt-4">
      <div className="text-sm font-semibold text-ink-primary">
        {paused.length === 1 ? '1 check is paused' : `${paused.length} checks are paused`}
      </div>
      <p className="text-xs text-ink-tertiary mt-1 leading-relaxed">
        These checks need details that are missing or out of date. Updating your profile starts them
        again.
      </p>
      <ul className="mt-2 space-y-1.5">
        {paused.map((d) => (
          <li key={d.detector_id} className="text-xs text-ink-secondary">
            <span className="font-medium text-ink-primary">{d.label}</span>
            {' — '}
            {d.state === 'paused_missing' ? 'missing: ' : 'out of date: '}
            {d.input.map(word).join(', ')}
          </li>
        ))}
      </ul>
    </GlassCard>
  )
}
