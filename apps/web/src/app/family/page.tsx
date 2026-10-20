'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { BarChart3, Settings, AlertTriangle, User } from 'lucide-react'
import { GlassCard, PageHeader, ListSection, ListRow, PageTransition } from '@/components/Glass'
import { FamilyRoster } from '@/components/FamilyRoster'
import { PullToRefresh } from '@/components/PullToRefresh'
import { ROLE_LABELS } from '@/lib/auth-types'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { fetchFinancialProfile, type FinancialProfile } from '@/lib/api'
import { PERSON_SCOPED_POLICY_TYPES } from '@/lib/policyTypes'

interface MemberChip {
  label: string
  onFile: boolean
}

/**
 * Per-member "what's on file" chips — replaced the old 0%/100% completion
 * bar, which reduced "has any data at all" into a number that implied far
 * more completeness than it could honestly claim (a member with only a
 * salary entered still showed 100%). Chips name the actual signals:
 * Income / Protection / Pension for earners, Education for children, each
 * either "on file" or "not yet" — an honest empty state when it isn't.
 */
function chipsFor(
  memberId: string,
  role: string,
  name: string,
  profile: FinancialProfile | null,
): MemberChip[] {
  if (!profile) return []
  const policies = profile.policies ?? []
  const covered = policies.some(
    (p) => !PERSON_SCOPED_POLICY_TYPES.has(p.type) || !p.member_id || p.member_id === memberId,
  )

  if (role === 'child') {
    const fund = profile.education_funds.some(
      (f) => f.member_id === memberId || f.child_name.toLowerCase() === name.toLowerCase(),
    )
    return [
      { label: 'Education fund', onFile: fund },
      { label: 'Covered by policies', onFile: covered },
    ]
  }

  const earner =
    role === 'organizer'
      ? {
          income:
            profile.household.monthly_salary_minor > 0 ||
            profile.household.employment_status !== 'unemployed',
          protection:
            profile.household.life_cover_minor > 0 ||
            profile.household.income_protection_monthly_minor > 0 ||
            covered,
          pension:
            (profile.retirement.pension_balance_minor ?? 0) > 0 ||
            (profile.retirement.monthly_contribution_minor ?? 0) > 0,
        }
      : (() => {
          const entry = profile.household.members.find((m) => m.member_id === memberId)
          return {
            income:
              !!entry &&
              (entry.monthly_salary_minor > 0 || entry.employment_status !== 'unemployed'),
            protection: (!!entry && entry.income_protection_monthly_minor > 0) || covered,
            pension:
              !!entry &&
              ((entry.pension_balance_minor ?? 0) > 0 ||
                (entry.monthly_pension_contribution_minor ?? 0) > 0),
          }
        })()

  return [
    { label: 'Income', onFile: earner.income },
    { label: 'Protection', onFile: earner.protection },
    { label: 'Pension', onFile: earner.pension },
  ]
}

export default function FamilyPage() {
  const { family } = useAuth()
  const [profile, setProfile] = useState<FinancialProfile | null>(null)
  const loadProfile = useCallback(async () => {
    const p = await fetchFinancialProfile()
    setProfile(p)
  }, [])
  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((p) => {
      if (!cancelled) setProfile(p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const familyMembers = (family?.members ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    emoji: m.emoji,
    role: ROLE_LABELS[m.role],
    chips: chipsFor(m.id, m.role, m.name, profile),
  }))

  return (
    <PageTransition>
      <PullToRefresh onRefresh={loadProfile}>
        <div className="px-5 pt-2 space-y-6">
          <PageHeader title="Our Family" />

          <FamilyRoster />

          {/* What's on file — per-member signal chips, not a fake percentage */}
          {familyMembers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
                <BarChart3 size={16} className="text-family-400" />
                What&apos;s on file
              </div>
              <div className="space-y-2">
                {familyMembers.map((m, i) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                  >
                    <GlassCard className="p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/15 flex items-center justify-center flex-shrink-0">
                        <User size={16} className="text-family-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-semibold">{m.name}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {m.chips.map((chip) => (
                            <span
                              key={chip.label}
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                chip.onFile
                                  ? 'text-success bg-success/10 border-success/20'
                                  : 'text-ink-tertiary bg-tint/[0.04] border-tint/[0.06]'
                              }`}
                            >
                              {chip.onFile && <span aria-hidden="true">✓ </span>}
                              {chip.label}
                              <span className="sr-only">
                                {chip.onFile ? ' — on file' : ' — not on file'}
                              </span>
                            </span>
                          ))}
                          {m.chips.length === 0 && (
                            <span className="text-xs text-ink-tertiary">
                              No data yet — fill in the financial profile
                            </span>
                          )}
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Quick links */}
          <ListSection>
            <Link href="/settings" onClick={() => haptic('light')}>
              <ListRow icon={Settings} label="Family Settings" chevron />
            </Link>
            <Link href="/events" onClick={() => haptic('light')}>
              <ListRow icon={AlertTriangle} label="What If Something Happens?" chevron />
            </Link>
          </ListSection>
        </div>
      </PullToRefresh>
    </PageTransition>
  )
}
