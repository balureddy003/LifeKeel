'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { BarChart3, Settings, AlertTriangle, Heart, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, PageHeader, ListSection, ListRow } from '@/components/Glass'
import { FAMILY_MEMBERS } from '@/lib/life-data'
import { useAppStore } from '@/lib/store'
import { haptic } from '@/lib/haptics'

export default function FamilyPage() {
  const storeFamily = useAppStore((s) => s.family)
  const familyMembers = storeFamily?.members ?? [
    { id: '1', name: 'Balu', emoji: '', role: 'Organizer', completion: 92 },
    { id: '2', name: 'Priya', emoji: '', role: 'Parent', completion: 74 },
    { id: '3', name: 'Emma', emoji: '', role: 'Child', completion: 100 },
    { id: '4', name: 'Lucas', emoji: '', role: 'Child', completion: 100 },
  ]

  return (
    <div className="px-5 pt-2 space-y-6">
      <PageHeader title="Our Family" />

      {/* Family graph */}
      <GlassCard className="p-6">
        <div className="flex flex-col items-center gap-5">
          {/* Parents */}
          <div className="flex items-center gap-8">
            {FAMILY_MEMBERS.filter((m) => m.id === 'dad' || m.id === 'mom').map((member, i) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1, type: 'spring', stiffness: 300, damping: 25 }}
              >
                <Link href={`/member/${member.id}`} onClick={() => haptic('light')}>
                  <motion.div
                    whileTap={{ scale: 0.9 }}
                    className="flex flex-col items-center gap-1"
                  >
                    <div
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{
                        background: 'rgba(124,110,240,0.08)',
                        border: '1px solid rgba(124,110,240,0.2)',
                        backdropFilter: 'blur(20px)',
                      }}
                    >
                      <User size={32} className="text-family-400" strokeWidth={1.5} />
                    </div>
                    <span className="text-sm font-semibold">{member.name}</span>
                    <span className="text-xs text-ink-tertiary">{member.role}</span>
                  </motion.div>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Heart connection */}
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Heart size={20} className="text-danger" />
          </motion.div>

          {/* Children */}
          <div className="flex gap-6">
            {FAMILY_MEMBERS.filter((m) => m.id === 'emma' || m.id === 'lucas').map((member, i) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
              >
                <Link href={`/member/${member.id}`} onClick={() => haptic('light')}>
                  <motion.div
                    whileTap={{ scale: 0.9 }}
                    className="flex flex-col items-center gap-1"
                  >
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        backdropFilter: 'blur(20px)',
                      }}
                    >
                      <User size={24} className="text-ink-secondary" strokeWidth={1.5} />
                    </div>
                    <span className="text-xs font-semibold">{member.name}</span>
                    <span className="text-[10px] text-ink-tertiary">{member.role}</span>
                  </motion.div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </GlassCard>

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
