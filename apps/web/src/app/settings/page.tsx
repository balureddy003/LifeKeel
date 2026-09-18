'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { PageHeader, ListSection, ListRow, GlassCard } from '@/components/Glass'
import { BottomSheet } from '@/components/BottomSheet'
import { useMode } from '@/lib/mode-context'
import { useAuth } from '@/lib/auth-context'
import { MODE_CONFIGS } from '@/lib/modes'
import { haptic } from '@/lib/haptics'
import type { AppMode } from '@/lib/modes'
import { ROLE_LABELS, type FamilyRole } from '@/lib/auth-types'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import { isValidEmailFormat } from '@/components/ConversationalOnboarding'
import { User, LogOut, Check, Crown, Shield, ShieldCheck, Baby, Accessibility, Plug, UserPlus, Loader2, AlertCircle, Calculator, Sparkles, HelpCircle, ScrollText, Bot, Download, Trash2 } from 'lucide-react'
import { exportAccountData, deleteAccount } from '@/lib/api'
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
  const { user, family, signOut, inviteMember, removeMember, updateMemberRole, updateProfile } = useAuth()
  const router = useRouter()
  const confirm = useConfirm()

  const [showAddMember, setShowAddMember] = useState(false)
  const [memberName, setMemberName] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<FamilyRole>('adult')
  const [addingMember, setAddingMember] = useState(false)
  const [addMemberError, setAddMemberError] = useState<string | null>(null)

  const [showEditProfile, setShowEditProfile] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [editProfileError, setEditProfileError] = useState<string | null>(null)

  // Data rights (remediation item 26): export downloads the tenant's own
  // data as JSON; delete is immediate and irreversible, confirmed by typing
  // the account email — the server enforces the same check.
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Reached from the home dashboard's "Add your partner or a caregiver"
  // banner (?add=1) — open the form immediately instead of making them
  // find "Add Member" in the list a second time. Read via window.location
  // rather than useSearchParams(), matching the workaround already used in
  // connect/email/page.tsx for the same static-export Suspense issue.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('add') === '1') setShowAddMember(true)
  }, [])

  const handleSignOut = () => {
    haptic('warning')
    signOut()
    router.push('/login')
  }

  const handleModeChange = (newMode: AppMode) => {
    haptic('success')
    setMode(newMode)
  }

  const openEditProfile = () => {
    haptic('light')
    setEditName(user?.name ?? '')
    setEditEmail(user?.email ?? '')
    setEditProfileError(null)
    setShowEditProfile(true)
  }

  const handleSaveProfile = async () => {
    const name = editName.trim()
    const email = editEmail.trim()
    if (!name) {
      setEditProfileError('Name is required.')
      return
    }
    if (!isValidEmailFormat(email)) {
      setEditProfileError("That doesn't look like a valid email.")
      return
    }
    haptic('light')
    setSavingProfile(true)
    setEditProfileError(null)
    try {
      const patch: { name?: string; email?: string } = {}
      if (name !== user?.name) patch.name = name
      if (email !== user?.email) patch.email = email
      if (Object.keys(patch).length > 0) await updateProfile(patch)
      haptic('success')
      setShowEditProfile(false)
    } catch (err) {
      haptic('warning')
      setEditProfileError(err instanceof Error ? err.message : 'Could not save your profile. Please try again.')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleExport = async () => {
    haptic('light')
    setExporting(true)
    setExportError(null)
    const bundle = await exportAccountData()
    setExporting(false)
    if (!bundle) {
      setExportError("Couldn't export right now — please try again.")
      return
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agentoak-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    haptic('success')
  }

  const handleDelete = async () => {
    if (deleteConfirm.trim().toLowerCase() !== (user?.email ?? '').toLowerCase()) {
      setDeleteError('Type your account email exactly to confirm.')
      return
    }
    haptic('warning')
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteAccount(deleteConfirm.trim())
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.error ?? "Couldn't delete your account — please try again.")
      return
    }
    // The account and its data are gone — local session cleanup then out.
    signOut()
    router.push('/welcome')
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
          chevron
          onClick={openEditProfile}
        >
          <div className="text-base font-medium">{user?.name ?? 'User'}</div>
        </ListRow>
      </ListSection>

      {/* How Oak acts on your behalf — the app's own trust-tier model
          (ARCHITECTURE.md: Tier 1 "prepare, don't send" today, nothing
          beyond it) was previously only a developer-facing concept. An
          app pitched as a family's "digital twin" that can draft things on
          your behalf should say what that boundary actually is, not leave
          the user to infer it from never having seen it act any other way. */}
      <GlassCard className="p-4 border-family-500/20 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
          <ShieldCheck size={18} className="text-family-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink-primary mb-1">How Oak acts on your behalf</div>
          <p className="text-xs text-ink-tertiary leading-relaxed">
            Oak can draft messages, checklists, and next steps from your family&apos;s data — but it never sends
            anything, changes your accounts, or takes action on its own. You always review and approve first.
          </p>
        </div>
      </GlassCard>

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
              pressed={active}
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
                      onClick={async (e) => {
                        e.stopPropagation()
                        const ok = await confirm({
                          title: `Remove ${m.name}?`,
                          message: `They'll lose access to the family's financial profile. This can't be undone.`,
                          confirmLabel: 'Remove',
                          destructive: true,
                        })
                        if (!ok) return
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
            onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
          <input
            type="email"
            placeholder="Email (optional)"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
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
            <div role="status" aria-live="polite" className="flex items-start gap-2 text-xs text-danger">
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
          <div className="text-xs text-ink-tertiary mt-0.5">Email, bank</div>
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

      {/* Oak Plus */}
      <ListSection title="Plan">
        <ListRow
          icon={Sparkles}
          onClick={() => { haptic('light'); router.push('/upgrade') }}
          chevron
        >
          <div className="text-base font-medium">Oak Plus</div>
          <div className="text-xs text-ink-tertiary mt-0.5">AI document extraction and inbox summaries</div>
        </ListRow>
      </ListSection>

      {/* Privacy & activity */}
      <ListSection title="Privacy & Activity">
        <ListRow
          icon={Bot}
          onClick={() => { haptic('light'); router.push('/settings/automation') }}
          chevron
        >
          <div className="text-base font-medium">Automation & Approvals</div>
          <div className="text-xs text-ink-tertiary mt-0.5">Dry-run mode and the trust Oak earns from your approvals</div>
        </ListRow>
        <ListRow
          icon={ScrollText}
          onClick={() => { haptic('light'); router.push('/audit-log') }}
          chevron
        >
          <div className="text-base font-medium">Activity Log</div>
          <div className="text-xs text-ink-tertiary mt-0.5">Every security-relevant action on your family's account</div>
        </ListRow>
        <ListRow
          icon={Download}
          onClick={handleExport}
          chevron={!exporting}
        >
          <div className="text-base font-medium">Export Your Data</div>
          <div className="text-xs text-ink-tertiary mt-0.5">
            {exporting ? 'Preparing your download…' : 'Download everything we hold about your family'}
          </div>
        </ListRow>
        {exportError && (
          <div className="px-4 pb-2 text-sm text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {exportError}
          </div>
        )}
        <ListRow
          icon={Trash2}
          onClick={() => { haptic('light'); setDeleteConfirm(''); setDeleteError(null); setShowDelete(true) }}
          chevron
        >
          <div className="text-base font-medium text-danger">Delete Account</div>
          <div className="text-xs text-ink-tertiary mt-0.5">Permanently remove your family's data</div>
        </ListRow>
      </ListSection>

      {/* Help & Support */}
      <ListSection title="Help">
        <ListRow
          icon={HelpCircle}
          onClick={() => { haptic('light'); router.push('/support') }}
          chevron
        >
          <div className="text-base font-medium">Help & Support</div>
          <div className="text-xs text-ink-tertiary mt-0.5">Contact us, report a problem</div>
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

      <BottomSheet open={showEditProfile} onClose={() => setShowEditProfile(false)} label="Edit profile">
        <div className="px-5 pb-6 pt-2">
          <div className="text-base font-bold text-ink-primary mb-4">Edit profile</div>
          <div className="space-y-3">
            <label className="block">
              <div className="text-xs text-ink-tertiary mb-1.5">Name</div>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !savingProfile && handleSaveProfile()}
                className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
              />
            </label>
            <label className="block">
              <div className="text-xs text-ink-tertiary mb-1.5">Email</div>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !savingProfile && handleSaveProfile()}
                className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
              />
            </label>
          </div>

          {editProfileError && (
            <div role="status" aria-live="polite" className="flex items-start gap-2 text-xs text-danger mt-3">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{editProfileError}</span>
            </div>
          )}

          <div className="flex gap-2 mt-5">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => { haptic('light'); setShowEditProfile(false) }}
              disabled={savingProfile}
              className="flex-1 glass text-ink-primary font-semibold rounded-xl py-3 text-sm disabled:opacity-40"
            >
              Cancel
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleSaveProfile}
              disabled={!editName.trim() || savingProfile}
              className="flex-1 bg-family-500 text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {savingProfile ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
            </motion.button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={showDelete} onClose={() => !deleting && setShowDelete(false)} label="Delete account">
        <div className="px-5 pb-6 pt-2">
          <div className="text-base font-bold text-ink-primary mb-2">Delete your account?</div>
          <p className="text-sm text-ink-secondary leading-relaxed mb-4">
            This permanently removes your family's profile, documents, insights, goals, and account
            sign-in. It can't be undone. The activity log is retained as a record of what happened,
            per our data-retention policy.
          </p>
          <label className="block">
            <div className="text-xs text-ink-tertiary mb-1.5">
              Type <span className="font-semibold text-ink-primary">{user?.email}</span> to confirm
            </div>
            <input
              type="email"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoComplete="off"
              className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger/30 transition-all"
            />
          </label>
          {deleteError && (
            <div role="status" aria-live="polite" className="flex items-start gap-2 text-xs text-danger mt-3">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{deleteError}</span>
            </div>
          )}
          <div className="flex gap-2 mt-5">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => { haptic('light'); setShowDelete(false) }}
              disabled={deleting}
              className="flex-1 glass text-ink-primary font-semibold rounded-xl py-3 text-sm disabled:opacity-40"
            >
              Cancel
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleDelete}
              disabled={deleting || !deleteConfirm.trim()}
              className="flex-1 bg-danger text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : 'Delete permanently'}
            </motion.button>
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}
