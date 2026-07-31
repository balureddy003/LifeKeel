'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { BarChart3, Settings, AlertTriangle, User } from 'lucide-react'
import { GlassCard, PageHeader, ListSection, ListRow } from '@/components/Glass'
import { KnowledgeGraph } from '@/components/KnowledgeGraph'
import { ROLE_LABELS } from '@/lib/auth-types'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'

export default function FamilyPage() {
  const { family } = useAuth()
  const familyMembers = family?.members.map((m) => ({
    id: m.id,
    name: m.name,
    emoji: m.emoji,
    role: ROLE_LABELS[m.role],
    completion: m.status === 'active' ? 100 : 40,
  })) ?? [
    { id: '1', name: 'Balu', emoji: '', role: 'Organizer', completion: 92 },
    { id: '2', name: 'Priya', emoji: '', role: 'Parent', completion: 74 },
    { id: '3', name: 'Emma', emoji: '', role: 'Child', completion: 100 },
    { id: '4', name: 'Lucas', emoji: '', role: 'Child', completion: 100 },
  ]

  return (
    <div className="px-5 pt-2 space-y-6">
      <PageHeader title="Our Family" />

      {/* Family graph — the real, connected graph (not a static illustration) */}
      <div className="h-[360px]">
        <KnowledgeGraph />
      </div>

      {/* Gamified completion */}
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
  )
}
