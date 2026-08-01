'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { PageHeader, ListSection, ListRow } from '@/components/Glass'
import { useMode } from '@/lib/mode-context'
import { useAuth } from '@/lib/auth-context'
import { MODE_CONFIGS } from '@/lib/modes'
import { haptic } from '@/lib/haptics'
import type { AppMode } from '@/lib/modes'
import { ROLE_LABELS } from '@/lib/auth-types'
import { User, LogOut, Check, Crown, Shield, Baby, Accessibility, Plug, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const MODE_ICONS: Record<string, LucideIcon> = {
  organizer: Crown,
  parent: Shield,
  adult: User,
  child: Baby,
  elderly: Accessibility,
}

const ROLE_ICONS: Record<string, LucideIcon> = {
  organizer: Crown,
  parent: Shield,
  adult: User,
  child: Baby,
}

export default function SettingsPage() {
  const { mode, setMode } = useMode()
  const { user, family, signOut, removeMember, updateMemberRole } = useAuth()
  const router = useRouter()

  const handleSignOut = () => {
    haptic('warning')
    signOut()
    router.push('/welcome')
  }

  const handleModeChange = (newMode: AppMode) => {
    haptic('success')
    setMode(newMode)
  }

  return (
    <div className="px-5 pt-2 space-y-6">
      <PageHeader title="Settings" />

      {/* Profile */}
      <ListSection>
        <ListRow
          icon={User}
          value={user?.email}
          onClick={() => {}}
        >
          <div className="text-base font-medium">{user?.name ?? 'User'}</div>
        </ListRow>
      </ListSection>

      {/* Experience Mode */}
      <ListSection title="Experience Mode">
        {(Object.keys(MODE_CONFIGS) as AppMode[]).map((m) => {
          const cfg = MODE_CONFIGS[m]
          const active = mode === m
          const ModeIcon = MODE_ICONS[m] ?? User
          return (
            <ListRow
              key={m}
              icon={ModeIcon}
              onClick={() => handleModeChange(m)}
              value={active ? <Check size={18} className="text-family-400" /> : null}
            >
              <div className="text-left">
                <div className="text-base font-medium">{cfg.label}</div>
                <div className="text-xs text-ink-tertiary mt-0.5">
                  {cfg.showMoney ? 'Shows financial data' : 'No money shown'} ·{' '}
                  {cfg.simpleLanguage ? 'Simple language' : 'Full detail'}
                </div>
              </div>
            </ListRow>
          )
        })}
      </ListSection>

      {/* Family Members */}
      {family && (
        <ListSection title="Family Members">
          {family.members.map((m) => (
            <ListRow key={m.id} icon={ROLE_ICONS[m.role] ?? User}>
              <div className="flex items-center justify-between w-full">
                <div className="text-left">
                  <div className="text-base font-medium">{m.name}</div>
                  <div className="text-xs text-ink-tertiary mt-0.5">{ROLE_LABELS[m.role]}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${m.status === 'pending' ? 'text-warning' : 'text-success'}`}>
                    {m.status === 'pending' ? 'Pending' : 'Active'}
                  </span>
                  {m.role !== 'organizer' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        haptic('warning')
                        removeMember(m.id)
                      }}
                      className="text-xs text-danger px-2 py-1 rounded-lg bg-danger/10"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </ListRow>
          ))}
          <ListRow label={`Invite code: ${family.inviteCode}`} />
        </ListSection>
      )}

      {/* Connected Services */}
      <ListSection title="Connected Services">
        <ListRow
          icon={Plug}
          onClick={() => { haptic('light'); router.push('/connect') }}
          chevron
        >
          <div className="text-base font-medium">Manage Connections</div>
          <div className="text-xs text-ink-tertiary mt-0.5">Email, bank, investments</div>
        </ListRow>
      </ListSection>

      {/* Sign out */}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSignOut}
        className="w-full rounded-2xl py-4 text-base font-semibold text-danger flex items-center justify-center gap-2"
        style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)' }}
      >
        <LogOut size={18} />
        Sign Out
      </motion.button>
    </div>
  )
}
