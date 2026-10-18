'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { PageHeader, ListSection, ListRow, GlassCard, PageTransition } from '@/components/Glass'
import { BottomSheet } from '@/components/BottomSheet'
import { useMode } from '@/lib/mode-context'
import { useAuth } from '@/lib/auth-context'
import { MODE_CONFIGS } from '@/lib/modes'
import { haptic } from '@/lib/haptics'
import { RegionSwitch } from '@/components/RegionSwitch'
import { useAppStore } from '@/lib/store'
import type { AppMode } from '@/lib/modes'
import { ROLE_LABELS, type FamilyRole } from '@/lib/auth-types'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import { NotificationsCard } from '@/components/NotificationsCard'
import { MfaSettings } from '@/components/MfaSettings'
import { useToast } from '@/components/Toast'
import { isValidEmailFormat } from '@/components/ConversationalOnboarding'
import {
  User,
  LogOut,
  Check,
  X,
  Crown,
  Shield,
  ShieldCheck,
  Baby,
  Accessibility,
  Plug,
  UserPlus,
  Loader2,
  AlertCircle,
  Calculator,
  Sparkles,
  HelpCircle,
  ScrollText,
  Bot,
  Download,
  Trash2,
  Sun,
  Moon,
  MonitorSmartphone,
  RefreshCw,
  Bell,
  Copy,
  Gift,
  HeartPulse,
} from 'lucide-react'
import {
  exportAccountData,
  deleteAccount,
  fetchAccessRequests,
  approveAccessRequest,
  denyAccessRequest,
  resetInviteCode,
  fetchMyReferralCode,
  fetchReferralSummary,
  fetchFamilyContinuity,
  updateFamilyContinuity,
  updateFamilyContext,
  fetchNotificationPrefs,
  updateNotificationPrefs,
  type AccessRequest,
  type FamilyContinuity,
  type NotificationPrefsResponse,
  type NotificationPrefsPatch,
} from '@/lib/api'
import { useThemePreference, type ThemePreference } from '@/lib/theme'
import { isIOS, isStandalone } from '@/lib/platform'
import {
  isPushSupported,
  isPushSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
  fetchVapidKey,
} from '@/lib/push'
import {
  isOnDeviceSupported,
  isOnDeviceEnabled,
  setOnDeviceEnabled as persistOnDeviceEnabled,
  enableOnDeviceModel,
} from '@/lib/onDeviceLlm'
import type { LucideIcon } from 'lucide-react'

const MODE_ICONS: Record<string, LucideIcon> = {
  organizer: Crown,
  parent: Shield,
  adult: User,
  child: Baby,
  elderly: Accessibility,
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: MonitorSmartphone },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
]

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
  const [theme, setTheme] = useThemePreference()
  const { user, family, signOut, inviteMember, removeMember, updateMemberRole, updateProfile } =
    useAuth()
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const profileCompleteness = useAppStore((s) => s.profileCompleteness)

  const [showAddMember, setShowAddMember] = useState(false)
  const [memberName, setMemberName] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<FamilyRole>('adult')
  // Optional — lets Financial Profile derive age/years-until-university
  // instead of asking again later. Never required here; skippable, added
  // at the point it's actually needed if left blank now.
  const [memberDob, setMemberDob] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [addMemberError, setAddMemberError] = useState<string | null>(null)

  // Family sharing (PRD-110) — only the organizer can see or act on these;
  // the same check the backend enforces (a roster entry whose id matches
  // this user's real id, with role 'organizer').
  // m.id === user.id covers the organizer + PRD-110 join-request members;
  // m.userId covers PRD-123 invite-accepted members whose roster id predates
  // their account.
  const isOrganizer =
    family?.members.find((m) => m.id === user?.id || m.userId === user?.id)?.role === 'organizer'
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([])
  const [actingOnRequestId, setActingOnRequestId] = useState<string | null>(null)
  const [accessRequestError, setAccessRequestError] = useState<string | null>(null)
  const [resettingCode, setResettingCode] = useState(false)
  const [inviteCodeOverride, setInviteCodeOverride] = useState<string | null>(null)

  useEffect(() => {
    if (!isOrganizer) return
    fetchAccessRequests().then(setAccessRequests)
    fetchFamilyContinuity().then(setContinuity)
  }, [isOrganizer])

  // Continuity plan (PRD-130) — organizer-only "if I go quiet" switch.
  // Changes save on each interaction; the state line underneath reflects
  // the persisted phase so the organizer can see the machine is live.
  const [continuity, setContinuity] = useState<FamilyContinuity | null>(null)
  const [continuityBusy, setContinuityBusy] = useState(false)

  const saveContinuity = async (next: FamilyContinuity['continuity']) => {
    if (continuityBusy) return
    setContinuityBusy(true)
    try {
      const saved = await updateFamilyContinuity(next)
      setContinuity((c) => (c ? { ...c, continuity: saved } : c))
      haptic('success')
    } catch (err) {
      haptic('warning')
      toast({
        message: err instanceof Error ? err.message : "Couldn't save continuity settings",
        variant: 'error',
      })
    } finally {
      setContinuityBusy(false)
    }
  }

  // Household context note (gap 8) — organizer-authored free text Ask Keel
  // reads as background. Seeded from the family record; save-on-click, not
  // per keystroke.
  const [contextNote, setContextNote] = useState(family?.contextNote ?? '')
  const [contextBusy, setContextBusy] = useState(false)
  const [contextSaved, setContextSaved] = useState(false)

  const saveContextNote = async () => {
    if (contextBusy) return
    setContextBusy(true)
    haptic('light')
    const saved = await updateFamilyContext(contextNote)
    setContextBusy(false)
    if (saved) {
      setContextSaved(true)
      haptic('success')
      setTimeout(() => setContextSaved(false), 2000)
    } else {
      haptic('warning')
      toast({ message: "Couldn't save that — try again", variant: 'error' })
    }
  }

  // Notification preference center (PRD-136 §5) — tenant-level delivery
  // prefs. Any adult reads them (children get a 403 → card hidden); only
  // the organizer edits. Each change saves immediately.
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefsResponse | null>(null)
  const [notifBusy, setNotifBusy] = useState(false)

  useEffect(() => {
    fetchNotificationPrefs().then(setNotifPrefs)
  }, [])

  const saveNotifPrefs = async (patch: NotificationPrefsPatch) => {
    if (notifBusy || !isOrganizer) return
    setNotifBusy(true)
    const saved = await updateNotificationPrefs(patch)
    setNotifBusy(false)
    if (saved) {
      setNotifPrefs(saved)
      haptic('success')
    } else {
      haptic('warning')
      toast({ message: "Couldn't save notification settings — try again", variant: 'error' })
    }
  }

  // Friend referral (PRD-112) — any family member can refer a friend to
  // their own, separate account, unlike the organizer-only invite code.
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [referralSummary, setReferralSummary] = useState({ pending: 0, rewarded: 0 })
  const [referralCopied, setReferralCopied] = useState(false)

  useEffect(() => {
    fetchMyReferralCode().then(setReferralCode)
    fetchReferralSummary().then(setReferralSummary)
  }, [])

  const handleCopyReferralLink = async () => {
    if (!referralCode) return
    haptic('light')
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/signup?ref=${referralCode}`)
      setReferralCopied(true)
      haptic('success')
      setTimeout(() => setReferralCopied(false), 2000)
    } catch {
      // Clipboard access can fail (permissions, non-secure context) — the
      // code is still shown on-screen, so nothing is actually lost.
    }
  }

  // On-device crisis drafts (PRD-113) — checked client-side on mount, not
  // SSR'd, since navigator.gpu doesn't exist during server rendering.
  const [onDeviceSupported, setOnDeviceSupportedState] = useState(false)
  const [onDeviceEnabled, setOnDeviceEnabled] = useState(false)
  const [onDeviceDownloading, setOnDeviceDownloading] = useState(false)
  const [onDeviceProgress, setOnDeviceProgress] = useState(0)

  useEffect(() => {
    setOnDeviceSupportedState(isOnDeviceSupported())
    setOnDeviceEnabled(isOnDeviceEnabled())
  }, [])

  // Push notifications — supported/enabled probed on mount so the toggle
  // reflects reality (a subscription made on another device shows as on).
  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushAvailable, setPushAvailable] = useState<boolean | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    if (!isPushSupported()) return
    setPushSupported(true)
    fetchVapidKey().then((key) => setPushAvailable(key !== null))
    isPushSubscribed().then(setPushEnabled)
  }, [])

  const handlePushToggle = async () => {
    if (pushBusy) return
    haptic('light')
    setPushBusy(true)
    if (pushEnabled) {
      const ok = await unsubscribeFromPush()
      if (ok) {
        setPushEnabled(false)
        haptic('success')
        toast({ message: 'Push notifications off for this device' })
      } else {
        haptic('warning')
        toast({
          message: "Couldn't turn notifications off — try again in a moment",
          variant: 'error',
        })
      }
    } else {
      const ok = await subscribeToPush()
      if (ok) {
        setPushEnabled(true)
        haptic('success')
        toast({
          message: 'Push notifications on — renewals and new insights will reach this device',
        })
      } else {
        haptic('warning')
        toast({
          message:
            Notification.permission === 'denied'
              ? 'Notifications are blocked in your browser settings — allow them there first'
              : "Couldn't turn notifications on — try again in a moment",
          variant: 'error',
        })
      }
    }
    setPushBusy(false)
  }

  const handleApproveRequest = async (id: string) => {
    haptic('light')
    setActingOnRequestId(id)
    setAccessRequestError(null)
    try {
      await approveAccessRequest(id)
      haptic('success')
      setAccessRequests((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      haptic('warning')
      setAccessRequestError(err instanceof Error ? err.message : 'Could not approve this request.')
    } finally {
      setActingOnRequestId(null)
    }
  }

  const handleDenyRequest = async (id: string) => {
    haptic('light')
    setActingOnRequestId(id)
    setAccessRequestError(null)
    try {
      await denyAccessRequest(id)
      haptic('success')
      setAccessRequests((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      haptic('warning')
      setAccessRequestError(err instanceof Error ? err.message : 'Could not deny this request.')
    } finally {
      setActingOnRequestId(null)
    }
  }

  const handleResetInviteCode = async () => {
    const ok = await confirm({
      title: 'Reset invite code?',
      message:
        'The old code stops working for new join requests. Anyone you already shared it with will need the new one.',
      confirmLabel: 'Reset',
      destructive: true,
    })
    if (!ok) return
    haptic('warning')
    setResettingCode(true)
    try {
      const newCode = await resetInviteCode()
      setInviteCodeOverride(newCode)
      haptic('success')
    } catch {
      haptic('warning')
    } finally {
      setResettingCode(false)
    }
  }

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
      toast({ message: 'Profile updated' })
      setShowEditProfile(false)
    } catch (err) {
      haptic('warning')
      setEditProfileError(
        err instanceof Error
          ? err.message
          : "Your changes didn't save — they're still here on this screen. Try again in a moment.",
      )
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
      setExportError(
        "The export didn't come through — your data is all still here. Try again in a moment.",
      )
      return
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lifekeel-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    haptic('success')
    toast({ message: 'Data exported' })
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
      setDeleteError(
        result.error ??
          "The deletion didn't complete — your account is untouched. Try again or contact support.",
      )
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
    setMemberDob('')
    setAddMemberError(null)
  }

  const handleAddMember = async () => {
    if (!memberName.trim()) return
    haptic('light')
    setAddingMember(true)
    setAddMemberError(null)
    try {
      await inviteMember(memberName.trim(), memberEmail.trim(), memberRole, memberDob || undefined)
      haptic('success')
      toast({ message: `${memberName.trim()} added to family` })
      resetAddMemberForm()
    } catch (err) {
      haptic('warning')
      setAddMemberError(
        err instanceof Error
          ? err.message
          : "That member wasn't added — your family roster is unchanged. Try again in a moment.",
      )
    } finally {
      setAddingMember(false)
    }
  }

  return (
    <PageTransition>
      <div className="px-5 pt-2 space-y-6">
        <PageHeader title="Settings" />

        {/* Profile */}
        {/* Live-verification finding: ListRow's `value` prop sits beside
          `children` in one items-center row, meant for a short label
          ("Active", "System") next to a name — not a second full-length
          string. With a real name+email, the name (no truncate on
          children) could wrap to two lines while the single-line email
          stayed vertically centered against the *whole* row, landing
          beside the name's second line instead of below it. Stacking both
          inside children (email truncated, name not) avoids the collision
          instead of fighting ListRow's layout for this one special case. */}
        <ListSection>
          <ListRow icon={User} chevron onClick={openEditProfile}>
            <div className="text-base font-medium">{user?.name ?? 'User'}</div>
            <div className="text-sm text-ink-tertiary truncate">{user?.email}</div>
          </ListRow>
        </ListSection>

        <MfaSettings />

        {/* How Keel acts on your behalf — the app's own trust-tier model
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
            <div className="text-sm font-semibold text-ink-primary mb-1">
              How Keel acts on your behalf
            </div>
            <p className="text-xs text-ink-tertiary leading-relaxed">
              Keel can draft messages, checklists, and next steps from your family&apos;s data — but
              it never sends anything, changes your accounts, or takes action on its own. You always
              review and approve first.
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

        {/* Appearance — dark stays the default; 'system' follows the OS
          live via prefers-color-scheme (see lib/theme.ts). */}
        <ListSection title="Appearance">
          {THEME_OPTIONS.map(({ value, label, icon: ThemeIcon }) => {
            const active = theme === value
            return (
              <ListRow
                key={value}
                icon={ThemeIcon}
                onClick={() => {
                  haptic('light')
                  setTheme(value)
                }}
                pressed={active}
                value={active ? <Check size={18} className="text-family-400" /> : null}
              >
                <div className="text-base font-medium">{label}</div>
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
                    <span
                      className={`text-xs ${m.status === 'pending' ? 'text-warning' : 'text-success'}`}
                    >
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
            <ListRow icon={UserPlus} onClick={() => setShowAddMember((v) => !v)}>
              <div className="text-base font-medium text-family-400">Add Member</div>
            </ListRow>
            <ListRow
              label={`Invite code: ${inviteCodeOverride ?? family.inviteCode}`}
              value={
                isOrganizer ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleResetInviteCode()
                    }}
                    disabled={resettingCode}
                    className="text-xs text-family-400 font-semibold px-2 py-1 rounded-lg bg-family-500/10 flex items-center gap-1"
                  >
                    {resettingCode ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    Reset
                  </button>
                ) : null
              }
            />
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

            <label className="block">
              <div className="text-xs text-ink-tertiary mb-1.5">Date of birth (optional)</div>
              <input
                type="date"
                value={memberDob}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setMemberDob(e.target.value)}
                className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
              />
            </label>

            <div className="flex gap-2">
              {INVITABLE_ROLES.map((role) => {
                const RoleIcon = ROLE_ICONS[role] ?? User
                const active = memberRole === role
                return (
                  <button
                    key={role}
                    onClick={() => {
                      haptic('light')
                      setMemberRole(role)
                    }}
                    className={`flex-1 rounded-xl py-2.5 flex flex-col items-center gap-1 border transition-colors ${
                      active
                        ? 'bg-family-500/15 border-family-500/40 text-family-400'
                        : 'bg-tint/[0.03] border-tint/[0.06] text-ink-secondary'
                    }`}
                  >
                    <RoleIcon size={16} />
                    <span className="text-xs font-medium">{ROLE_LABELS[role]}</span>
                  </button>
                )
              })}
            </div>

            {addMemberError && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 text-xs text-danger"
              >
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

        {/* Access requests (PRD-110) — organizer-only. A pending request never
          grants any access by itself; this is the one place that does. */}
        {isOrganizer && accessRequests.length > 0 && (
          <ListSection title="Join Requests">
            {accessRequestError && (
              <p role="status" aria-live="polite" className="text-xs text-danger px-4 py-2">
                {accessRequestError}
              </p>
            )}
            {accessRequests.map((r) => (
              <ListRow key={r.id} icon={UserPlus}>
                <div className="flex items-center justify-between w-full gap-3">
                  <div className="text-left min-w-0">
                    <div className="text-base font-medium truncate">{r.name}</div>
                    <div className="text-xs text-ink-tertiary mt-0.5 truncate">{r.email}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {actingOnRequestId === r.id ? (
                      <Loader2 size={16} className="animate-spin text-ink-tertiary" />
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleApproveRequest(r.id)
                          }}
                          aria-label={`Approve ${r.name}`}
                          className="w-8 h-8 rounded-lg bg-success/10 text-success flex items-center justify-center"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDenyRequest(r.id)
                          }}
                          aria-label={`Deny ${r.name}`}
                          className="w-8 h-8 rounded-lg bg-danger/10 text-danger flex items-center justify-center"
                        >
                          <X size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </ListRow>
            ))}
          </ListSection>
        )}

        {/* Continuity plan (PRD-130) — organizer-only. If the organizer
          goes quiet past the threshold, Keel emails them a check-in, then
          (after grace) notifies the designated adults. It never grants
          access — the vault's standing adult access already covers that;
          this exists so the right people get tapped on the shoulder. */}
        {isOrganizer && continuity && (
          <ListSection title="Continuity Plan">
            <ListRow icon={HeartPulse}>
              <div className="flex items-center justify-between w-full gap-3">
                <div className="text-left min-w-0">
                  <div className="text-base font-medium">If I go quiet</div>
                  <div className="text-xs text-ink-tertiary mt-0.5">
                    Check in with me after {continuity.continuity.check_in_after_days} days of no
                    activity, then let the people below know
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={continuity.continuity.enabled}
                  disabled={continuityBusy}
                  onClick={async (e) => {
                    e.stopPropagation()
                    haptic('light')
                    await saveContinuity({
                      ...continuity.continuity,
                      enabled: !continuity.continuity.enabled,
                    })
                  }}
                  className={`w-12 h-7 rounded-full flex-shrink-0 flex items-center px-1 transition-colors ${continuity.continuity.enabled ? 'bg-family-500' : 'bg-tint/10'}`}
                >
                  <motion.div
                    className="w-5 h-5 rounded-full bg-white"
                    animate={{ x: continuity.continuity.enabled ? 20 : 0 }}
                  />
                </button>
              </div>
            </ListRow>
            {continuity.continuity.enabled && (
              <>
                {family?.members
                  .filter(
                    (m) =>
                      m.role !== 'organizer' &&
                      m.role !== 'child' &&
                      m.status === 'active' &&
                      m.email,
                  )
                  .map((m) => {
                    const picked = continuity.continuity.designated_member_ids.includes(m.id)
                    return (
                      <ListRow
                        key={m.id}
                        icon={User}
                        onClick={async () => {
                          haptic('light')
                          const ids = picked
                            ? continuity.continuity.designated_member_ids.filter(
                                (id) => id !== m.id,
                              )
                            : [...continuity.continuity.designated_member_ids, m.id]
                          await saveContinuity({
                            ...continuity.continuity,
                            designated_member_ids: ids,
                          })
                        }}
                        pressed={picked}
                        value={picked ? <Check size={18} className="text-family-400" /> : null}
                      >
                        <div className="text-base font-medium">Tell {m.name}</div>
                      </ListRow>
                    )
                  })}
                <ListRow>
                  <div className="flex items-center justify-between w-full gap-3">
                    <div className="text-left min-w-0">
                      <div className="text-sm text-ink-secondary">Check in after</div>
                    </div>
                    <select
                      value={continuity.continuity.check_in_after_days}
                      disabled={continuityBusy}
                      onChange={async (e) => {
                        await saveContinuity({
                          ...continuity.continuity,
                          check_in_after_days: Number(e.target.value),
                        })
                      }}
                      className="glass-input rounded-lg px-3 py-1.5 text-sm text-ink-primary outline-none"
                    >
                      {[14, 30, 60, 90].map((d) => (
                        <option key={d} value={d}>
                          {d} days
                        </option>
                      ))}
                    </select>
                  </div>
                </ListRow>
                <ListRow>
                  <p className="text-xs text-ink-tertiary">
                    {continuity.state.phase === 'watching'
                      ? 'Watching — opening the app resets the clock automatically.'
                      : continuity.state.phase === 'check_in_sent'
                        ? 'A check-in email has been sent — opening the app clears it.'
                        : 'Designated contacts have been notified — opening the app resets everything.'}
                  </p>
                </ListRow>
              </>
            )}
          </ListSection>
        )}

        {/* Gap-8 context slice: a short organizer-authored note Ask Keel
          reads as household background. Same sensitivity class as the
          financial profile; the copy asks for no medical details. */}
        {isOrganizer && (
          <ListSection title="Household Context">
            <ListRow>
              <div className="w-full space-y-2 text-left">
                <p className="text-xs text-ink-tertiary leading-relaxed">
                  Anything Keel should know that the profile doesn’t capture — “we’re a blended
                  family”, “Maya finishes uni in 2027”. Please don’t include medical details.
                </p>
                <textarea
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. We’re a blended family; the flat in Leeds is Mum’s."
                  value={contextNote}
                  onChange={(e) => setContextNote(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 resize-none"
                />
                <button
                  type="button"
                  disabled={contextBusy || contextNote === (family?.contextNote ?? '')}
                  onClick={saveContextNote}
                  className="text-xs font-semibold text-family-400 disabled:opacity-40"
                >
                  {contextBusy ? 'Saving…' : contextSaved ? 'Saved' : 'Save context'}
                </button>
              </div>
            </ListRow>
          </ListSection>
        )}
        {/* Friend referral (PRD-112) — a completely separate account for the
          friend, not another member of this family; no organizer gate. */}
        {family && (
          <ListSection title="Refer a Friend">
            <ListRow
              icon={Gift}
              label={referralCode ? `Your link: /signup?ref=${referralCode}` : 'Loading…'}
              value={
                referralCode ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCopyReferralLink()
                    }}
                    className="text-xs text-family-400 font-semibold px-2 py-1 rounded-lg bg-family-500/10 flex items-center gap-1"
                  >
                    {referralCopied ? <Check size={12} /> : <Copy size={12} />}
                    {referralCopied ? 'Copied' : 'Copy'}
                  </button>
                ) : null
              }
            />
            {(referralSummary.pending > 0 || referralSummary.rewarded > 0) && (
              <ListRow>
                <p className="text-xs text-ink-tertiary">
                  {referralSummary.rewarded} friend{referralSummary.rewarded === 1 ? '' : 's'}{' '}
                  joined and rewarded
                  {referralSummary.pending > 0 ? ` · ${referralSummary.pending} pending` : ''}
                </p>
              </ListRow>
            )}
          </ListSection>
        )}

        {/* Financial profile */}
        <ListSection title="Personalized Insights">
          <ListRow
            icon={Calculator}
            onClick={() => {
              haptic('light')
              router.push('/financial-profile')
            }}
            chevron
          >
            <div className="text-base font-medium flex items-center gap-2">
              Financial Profile
              {profileCompleteness > 0 && profileCompleteness < 100 && (
                <span className="text-xs font-semibold text-family-400">
                  {profileCompleteness}%
                </span>
              )}
            </div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              Income, savings, pension — powers your real readiness scores
            </div>
          </ListRow>
        </ListSection>

        {/* Connected Services */}
        <ListSection title="Connected Services">
          <ListRow
            icon={Plug}
            onClick={() => {
              haptic('light')
              router.push('/connect')
            }}
            chevron
          >
            <div className="text-base font-medium">Manage Connections</div>
            <div className="text-xs text-ink-tertiary mt-0.5">Email, bank</div>
          </ListRow>
        </ListSection>

        {/* Push notifications — only shown on browsers that support them.
          Subscribing is the opt-in: the OS permission prompt is the
          explicit gesture, and Keel pushes what the detectors produce
          (renewals, new insights) — never marketing. */}
        {isIOS() && !isStandalone() ? (
          // iOS only allows web push from an *installed* home-screen app —
          // in a Safari tab PushManager exists but subscribing fails, so a
          // live toggle here would be a dead control. Point at the install
          // path instead, and reassure that email alerts still work.
          <ListSection title="Notifications">
            <ListRow icon={Bell}>
              <div>
                <div className="text-base font-medium">Push notifications</div>
                <div className="text-xs text-ink-tertiary mt-0.5">
                  On iPhone and iPad, add LifeKeel to your Home Screen first — push only works from
                  the installed app. Email alerts work either way.
                </div>
              </div>
            </ListRow>
          </ListSection>
        ) : (
          pushSupported && (
            <ListSection title="Notifications">
              <ListRow icon={Bell}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-medium">Push notifications</div>
                    <div className="text-xs text-ink-tertiary mt-0.5">
                      {pushAvailable === false
                        ? 'Not available on this server yet'
                        : 'Renewals and new insights — never marketing'}
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={pushEnabled}
                    aria-label="Push notifications"
                    disabled={pushAvailable === false || pushBusy}
                    onClick={handlePushToggle}
                    className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-40 flex-shrink-0 ${
                      pushEnabled ? 'bg-family-500' : 'bg-tint/10'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                        pushEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </ListRow>
            </ListSection>
          )
        )}

        {/* PRD-136 §5: notification preference center — how Keel reaches the
          family (channel order, quiet hours, digest, urgency floor), the
          heartbeat cadence, and which domains/members the feed-shaped
          messages cover. Hidden for children (the API 403s them); adults
          who aren't the organizer see the same card read-only. */}
        {notifPrefs && (
          <NotificationsCard
            prefs={notifPrefs.preferences}
            exemptCriticals={notifPrefs.exempt_criticals}
            isOrganizer={isOrganizer ?? false}
            busy={notifBusy}
            onPatch={(patch) => void saveNotifPrefs(patch)}
          />
        )}

        {/* Keel Plus */}
        <ListSection title="Plan">
          <ListRow
            icon={Sparkles}
            onClick={() => {
              haptic('light')
              router.push('/upgrade')
            }}
            chevron
          >
            <div className="text-base font-medium">Keel Plus</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              AI document extraction and inbox summaries
            </div>
          </ListRow>
        </ListSection>

        {/* On-device crisis drafts (PRD-113) — hidden entirely on a browser
          without WebGPU rather than shown disabled; no dead toggle to
          explain. */}
        {onDeviceSupported && (
          <ListSection title="On-device AI">
            <ListRow icon={ShieldCheck}>
              <div className="flex items-center justify-between w-full gap-3">
                <div className="text-left min-w-0">
                  <div className="text-base font-medium">Generate crisis drafts on this device</div>
                  <div className="text-xs text-ink-tertiary mt-0.5">
                    {onDeviceDownloading
                      ? `Downloading… ${onDeviceProgress}%`
                      : 'A one-time ~700MB download, then life-event drafts never leave this device'}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={onDeviceEnabled}
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (onDeviceDownloading) return
                    haptic('light')
                    const next = !onDeviceEnabled
                    if (next) {
                      setOnDeviceDownloading(true)
                      const ok = await enableOnDeviceModel(setOnDeviceProgress)
                      setOnDeviceDownloading(false)
                      if (!ok) {
                        haptic('warning')
                        return
                      }
                    }
                    persistOnDeviceEnabled(next)
                    setOnDeviceEnabled(next)
                    haptic('success')
                  }}
                  className={`w-12 h-7 rounded-full flex-shrink-0 flex items-center px-1 transition-colors ${onDeviceEnabled ? 'bg-family-500' : 'bg-tint/10'}`}
                >
                  <motion.div
                    className="w-5 h-5 rounded-full bg-white"
                    animate={{ x: onDeviceEnabled ? 20 : 0 }}
                  />
                </button>
              </div>
            </ListRow>
          </ListSection>
        )}

        {/* Privacy & activity */}
        <ListSection title="Privacy & Activity">
          <ListRow
            icon={Bot}
            onClick={() => {
              haptic('light')
              router.push('/settings/automation')
            }}
            chevron
          >
            <div className="text-base font-medium">Automation & Approvals</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              Dry-run mode and the trust Keel earns from your approvals
            </div>
          </ListRow>
          <ListRow
            icon={ScrollText}
            onClick={() => {
              haptic('light')
              router.push('/audit-log')
            }}
            chevron
          >
            <div className="text-base font-medium">Activity Log</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              Every security-relevant action on your family's account
            </div>
          </ListRow>
          <ListRow icon={Download} onClick={handleExport} chevron={!exporting}>
            <div className="text-base font-medium">Export Your Data</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              {exporting
                ? 'Preparing your download…'
                : 'Download everything we hold about your family'}
            </div>
          </ListRow>
          {exportError && (
            <div className="px-4 pb-2 text-sm text-danger flex items-center gap-2">
              <AlertCircle size={14} /> {exportError}
            </div>
          )}
          <ListRow
            icon={Trash2}
            onClick={() => {
              haptic('light')
              setDeleteConfirm('')
              setDeleteError(null)
              setShowDelete(true)
            }}
            chevron
          >
            <div className="text-base font-medium text-danger">Delete Account</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              Permanently remove your family's data
            </div>
          </ListRow>
        </ListSection>

        {/* Help & Support */}
        <ListSection title="Help">
          <ListRow
            icon={HelpCircle}
            onClick={() => {
              haptic('light')
              router.push('/support')
            }}
            chevron
          >
            <div className="text-base font-medium">Help & Support</div>
            <div className="text-xs text-ink-tertiary mt-0.5">Contact us, report a problem</div>
          </ListRow>
        </ListSection>

        <RegionSwitch className="mb-4" />

        {/* Sign out */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleSignOut}
          className="w-full rounded-2xl py-4 text-base font-semibold text-danger flex items-center justify-center gap-2"
          style={{
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.15)',
          }}
        >
          <LogOut size={18} />
          Sign Out
        </motion.button>

        <BottomSheet
          open={showEditProfile}
          onClose={() => setShowEditProfile(false)}
          label="Edit profile"
        >
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
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 text-xs text-danger mt-3"
              >
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{editProfileError}</span>
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  haptic('light')
                  setShowEditProfile(false)
                }}
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

        <BottomSheet
          open={showDelete}
          onClose={() => !deleting && setShowDelete(false)}
          label="Delete account"
        >
          <div className="px-5 pb-6 pt-2">
            <div className="text-base font-bold text-ink-primary mb-2">Delete your account?</div>
            <p className="text-sm text-ink-secondary leading-relaxed mb-4">
              This permanently removes your family's profile, documents, insights, goals, and
              account sign-in. It can't be undone. The activity log is retained as a record of what
              happened, per our data-retention policy.
            </p>
            <label className="block">
              <div className="text-xs text-ink-tertiary mb-1.5">
                Type <span className="font-semibold text-ink-primary">{user?.email}</span> to
                confirm
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
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 text-xs text-danger mt-3"
              >
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}
            <div className="flex gap-2 mt-5">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  haptic('light')
                  setShowDelete(false)
                }}
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
    </PageTransition>
  )
}
