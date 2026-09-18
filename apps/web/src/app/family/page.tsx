'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { BarChart3, Settings, AlertTriangle, User } from 'lucide-react'
import { GlassCard, PageHeader, ListSection, ListRow } from '@/components/Glass'
import { FamilyRoster } from '@/components/FamilyRoster'
import { PullToRefresh } from '@/components/PullToRefresh'
import { ROLE_LABELS } from '@/lib/auth-types'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { fetchFinancialProfile, type FinancialProfile } from '@/lib/api'

export default function FamilyPage() {
  const { family } = useAuth()
  // Was `m.status === 'active' ? 100 : 40` — a number that read as "how
  // complete is this person's financial picture" but was actually just
  // whether they'd accepted their invite yet, completely disconnected from
  // whether any real data existed for them. Confirmed live: a member with a
  // fully-populated PRD-104 members[] entry (real salary, real protection
  // figures) still showed 40% for no reason other than a pending invite.
  // Real completeness instead: the organizer's data lives in the flat
  // household fields; everyone else's lives in household.members[] — 100
  // if either is genuinely populated, 0 if not. Binary, not a finer-grained
  // score, so it never implies partial progress that isn't real.
  const [profile, setProfile] = useState<FinancialProfile | null>(null)
  const loadProfile = useCallback(async () => {
    const p = await fetchFinancialProfile()
    setProfile(p)
  }, [])
  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [])

  function completionFor(memberId: string, role: string): number {
    if (!profile) return 0
    if (role === 'organizer') {
      return profile.household.monthly_salary_minor > 0 || profile.household.employment_status !== 'unemployed' ? 100 : 0
    }
    return profile.household.members.some((m) => m.member_id === memberId) ? 100 : 0
  }

  const familyMembers = (family?.members ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    emoji: m.emoji,
    role: ROLE_LABELS[m.role],
    completion: completionFor(m.id, m.role),
  }))

  return (
    <PullToRefresh onRefresh={loadProfile}>
    <div className="px-5 pt-2 space-y-6">
      <PageHeader title="Our Family" />

      <FamilyRoster />

      {/* Gamified completion */}
      {familyMembers.length > 0 && (
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
          <BarChart3 size={16} className="text-family-400" />
          Family Completion
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
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold">{m.name}</span>
                    <span className={`text-xs font-bold ${m.completion >= 90 ? 'text-success' : m.completion >= 70 ? 'text-warning' : 'text-danger'}`}>
                      {m.completion}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: m.completion >= 90 ? '#4ade80' : m.completion >= 70 ? '#fbbf24' : '#f87171',
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${m.completion}%` }}
                      transition={{ delay: i * 0.08 + 0.3, duration: 0.8 }}
                    />
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
  )
}
