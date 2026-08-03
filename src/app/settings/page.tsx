'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { PageHeader, ListSection, ListRow, GlassCard } from '@/components/Glass'
import { useMode } from '@/lib/mode-context'
import { useAuth } from '@/lib/auth-context'
import { MODE_CONFIGS } from '@/lib/modes'
import { haptic } from '@/lib/haptics'
import type { AppMode } from '@/lib/modes'
import { ROLE_LABELS, type FamilyRole } from '@/lib/auth-types'
import { User, LogOut, Check, Crown, Shield, Baby, Accessibility, Plug, UserPlus, Loader2, AlertCircle, Calculator } from 'lucide-react'
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

// Organizer is reserved for the account owner (seeded automatically when the
// family is created) — everyone added afterward picks one of these.
const INVITABLE_ROLES: FamilyRole[] = ['parent', 'adult', 'child']

export default function SettingsPage() {
  const { mode, setMode } = useMode()
  const { user, family, signOut, inviteMember, removeMember, updateMemberRole } = useAuth()
  const router = useRouter()

  const [showAddMember, setShowAddMember] = useState(false)
  const [memberName, setMemberName] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<FamilyRole>('adult')
  const [addingMember, setAddingMember] = useState(false)
  const [addMemberError, setAddMemberError] = useState<string | null>(null)

  const handleSignOut = () => {
    haptic('warning')
    signOut()
    router.push('/welcome')
  }

  const handleModeChange = (newMode: AppMode) => {
    haptic('success')
    setMode(newMode)
  }

  const resetAddMemberForm = () => {
    setShowAddMember(false)
    setMemberName('')
    setMemberEmail('')
    setMemberRole('adult')
    setAddMemberError(null)
  }

  const handleAddMember = async () => {
    if (!memberName.trim()) return
    haptic('light')
    setAddingMember(true)
    setAddMemberError(null)
    try {
      await inviteMember(memberName.trim(), memberEmail.trim(), memberRole)
      haptic('success')
      resetAddMemberForm()
    } catch (err) {
      haptic('warning')
      setAddMemberError(err instanceof Error ? err.message : 'Could not add member. Please try again.')
    } finally {
      setAddingMember(false)
    }
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
                        removeMember(m.id).catch(() => haptic('warning'))
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
          <ListRow
            icon={UserPlus}
            onClick={() => setShowAddMember((v) => !v)}
          >
            <div className="text-base font-medium text-family-400">Add Member</div>
          </ListRow>
          <ListRow label={`Invite code: ${family.inviteCode}`} />
        </ListSection>
      )}

      {/* Add Member form — plain conditional render, no AnimatePresence.
          Framer Motion's exit animations (including non-height variants)
          were observed getting stuck mid-transition in this dev environment,
          leaving the form visually open after Cancel/successful Add even
          though the underlying state had already reset correctly. Reliability
          here matters more than a fade transition. */}
      {showAddMember && (
        <GlassCard className="p-4 space-y-3">
          <input
            type="text"
            placeholder="Name"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
          <input
            type="email"
            placeholder="Email (optional)"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />

          <div className="flex gap-2">
            {INVITABLE_ROLES.map((role) => {
              const RoleIcon = ROLE_ICONS[role] ?? User
              const active = memberRole === role
              return (
                <button
                  key={role}
                  onClick={() => { haptic('light'); setMemberRole(role) }}
                  className={`flex-1 rounded-xl py-2.5 flex flex-col items-center gap-1 border transition-colors ${
                    active
                      ? 'bg-family-500/15 border-family-500/40 text-family-400'
                      : 'bg-white/[0.03] border-white/[0.06] text-ink-secondary'
                  }`}
                >
                  <RoleIcon size={16} />
                  <span className="text-xs font-medium">{ROLE_LABELS[role]}</span>
                </button>
              )
            })}
          </div>

          {addMemberError && (
            <div className="flex items-start gap-2 text-xs text-danger">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{addMemberError}</span>
            </div>
          )}

          <div className="flex gap-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={resetAddMemberForm}
              disabled={addingMember}
              className="flex-1 glass text-ink-primary font-semibold rounded-xl py-3 text-sm disabled:opacity-40"
            >
              Cancel
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleAddMember}
              disabled={!memberName.trim() || addingMember}
              className="flex-1 bg-family-500 text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {addingMember ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
            </motion.button>
          </div>
        </GlassCard>
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

      {/* Financial profile */}
      <ListSection title="Personalized Insights">
        <ListRow
          icon={Calculator}
          onClick={() => { haptic('light'); router.push('/financial-profile') }}
          chevron
        >
          <div className="text-base font-medium">Financial Profile</div>
          <div className="text-xs text-ink-tertiary mt-0.5">Income, savings, pension — powers your real readiness scores</div>
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
