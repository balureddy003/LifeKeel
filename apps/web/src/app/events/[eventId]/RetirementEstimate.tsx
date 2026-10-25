'use client'

/**
 * Intent 32: "what would close the gap" — an interactive estimate on the
 * retirement event surface. A contribution slider re-projects via the
 * server's own projectRetirement math (GET /family/retirement/estimate);
 * nothing here writes to the profile. Clearly labelled an estimate —
 * arithmetic on the family's own inputs, never a recommendation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { fetchRetirementEstimate, type RetirementEstimate } from '@/lib/api'

export default function RetirementEstimate() {
  const [estimate, setEstimate] = useState<RetirementEstimate | null>(null)
  const [contribution, setContribution] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (contributionMinor?: number) => {
    const r = await fetchRetirementEstimate(
      contributionMinor === undefined ? {} : { monthlyContributionMinor: contributionMinor },
    )
    setEstimate(r)
    if (contributionMinor === undefined && r.current) {
      setContribution(r.current.monthly_contribution_minor)
    }
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [load])

  const onSlide = (v: number) => {
    setContribution(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => load(v), 300)
  }

  if (!estimate?.hasData || !estimate.projection || !estimate.current) return null
  const p = estimate.projection
  const target = p.target_retirement_income_minor
  const gapCloses = p.achievable_retirement_income_minor >= target
  const fmt = (minor: number) =>
    `£${(minor / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`

  return (
    <GlassCard className="p-5">
      <div className="text-sm font-semibold text-ink-primary mb-1">What would close the gap?</div>
      <p className="text-xs text-ink-tertiary mb-4">
        An estimate based on the figures you entered — it doesn&apos;t change anything on file.
      </p>
      <label className="block mb-1 text-xs text-ink-secondary">
        Monthly contribution: <strong>{fmt(contribution ?? 0)}</strong>
        {contribution !== null && contribution !== estimate.current.monthly_contribution_minor && (
          <span className="text-ink-tertiary">
            {' '}
            (on file: {fmt(estimate.current.monthly_contribution_minor)})
          </span>
        )}
      </label>
      <input
        type="range"
        min={0}
        max={Math.max(200000, estimate.current.monthly_contribution_minor * 3)}
        step={500}
        value={contribution ?? 0}
        onChange={(e) => onSlide(Number(e.target.value))}
        className="w-full accent-family-500"
        aria-label="Monthly pension contribution to estimate"
      />
      <p className="text-sm text-ink-primary mt-3">
        {gapCloses
          ? `At ${fmt(contribution ?? 0)}/month the projection meets your ${fmt(target)}/yr target around age ${p.projected_retirement_age}.`
          : `At ${fmt(contribution ?? 0)}/month the projection supports about ${fmt(p.achievable_retirement_income_minor)}/yr against a ${fmt(target)}/yr target — a gap remains.`}
      </p>
    </GlassCard>
  )
}
