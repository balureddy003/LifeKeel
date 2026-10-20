'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  Bot,
  Info,
  Home,
  Landmark,
  Wallet,
  Plane,
  CreditCard,
  Car,
  Loader2,
  CheckCircle2,
  Share2,
  Copy,
  MessageCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  GlassCard,
  PageHeader,
  EmptyState,
  MoneyText,
  Skeleton,
  PageTransition,
} from '@/components/Glass'
import { PullToRefresh } from '@/components/PullToRefresh'
import { SwipeableRow } from '@/components/SwipeableRow'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import type { InboxItem } from '@/lib/onboarding-data'
import {
  fetchInboxItems,
  dismissInboxItem,
  scanEmailInbox,
  fetchEmailConnectorStatus,
  applyInboxPolicy,
  fetchMyReferralCode,
  type PolicyType,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { PolicyReviewForm, type PolicyDraft } from '@/components/PolicyReviewForm'
import { invalidateCache } from '@/lib/fetch-cache'
import { useAppStore } from '@/lib/store'
import { searchMailboxForPolicies } from '@/lib/email-lookback'
import { formatRelativeDate } from '@/lib/format'

const INBOX_ICONS: Record<string, LucideIcon> = {
  '1': Home,
  '2': Landmark,
  '3': Wallet,
  '4': Plane,
  '5': CreditCard,
  '6': Car,
}

const priorityColor = (priority: 'high' | 'medium' | 'low') => {
  const colors = { high: '#f87171', medium: '#fbbf24', low: '#4ade80' }
  return colors[priority]
}

const actionTypeColor = (type: InboxItem['actionType']) => {
  const colors: Record<string, string> = {
    review: '#fbbf24',
    renew: '#f87171',
    compare: '#60a5fa',
    update: '#38bdf8',
    info: '#8a8070',
  }
  return colors[type] ?? '#8a8070'
}

const VALID_POLICY_TYPES = new Set<PolicyType>([
  'life',
  'income_protection',
  'health',
  'critical_illness',
  'car',
  'home',
  'travel',
])

function toPolicyDraft(p: NonNullable<InboxItem['policy']>): PolicyDraft {
  // The email can state a type this app's profile has no home for yet
  // (pension, mortgage, "other") — default to something the user picks
  // from rather than silently mismatching the dropdown.
  return {
    type: p.type && VALID_POLICY_TYPES.has(p.type as PolicyType) ? (p.type as PolicyType) : 'life',
    provider: p.provider ?? '',
    coverageAmount: p.coverAmount != null ? String(p.coverAmount) : '',
    monthlyPremium: p.monthlyPremium != null ? String(p.monthlyPremium) : '',
    renewalDate: p.renewalDate ?? '',
    policyNumber: p.policyNumber ?? '',
    memberId: '',
    contactPhone: p.contactPhone ?? '',
    contactEmail: p.contactEmail ?? '',
  }
}

function policyFacts(p: NonNullable<InboxItem['policy']>): [string, string][] {
  const money = (n: number) => `${p.currency ?? ''} ${n.toLocaleString()}`.trim()
  const rows: [string, string | undefined][] = [
    ['Provider', p.provider],
    ['Type', p.type?.replace(/_/g, ' ')],
    ['Policy no.', p.policyNumber],
    ['Cover', p.coverAmount !== undefined ? money(p.coverAmount) : undefined],
    ['Premium / month', p.monthlyPremium !== undefined ? money(p.monthlyPremium) : undefined],
    ['Renews', p.renewalDate],
    ['Claims phone', p.contactPhone],
    ['Claims email', p.contactEmail],
  ]
  return rows.filter((r): r is [string, string] => !!r[1])
}

export default function InboxPage() {
  const router = useRouter()
  const { family } = useAuth()
  const connectedConnectors = useAppStore((s) => s.connectedConnectors)
  const setInboxUnreadCount = useAppStore((s) => s.setInboxUnreadCount)
  const toast = useToast()
  // Pending undo timers — cleared if the user taps "Undo" before they fire.
  const undoTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [items, setItems] = useState<InboxItem[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [lookingBack, setLookingBack] = useState(false)
  // The "review, then confirm" policy form for whichever email-sourced item
  // is currently expanded (only one item is ever expanded at a time).
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null)
  const [policyApplying, setPolicyApplying] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)
  // Ids of items successfully applied this session — kept even after the
  // item leaves `items` (server-dismissed) isn't needed since a fresh
  // fetch drops it entirely, but covers the moment right after applying,
  // before that refetch lands.
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  // Distinct from "nothing to show you" — a genuine failure to reach the
  // server (see apiFetch's onFailure), so the empty state doesn't lie.
  const [loadError, setLoadError] = useState(false)
  // The inbox mixes two different mental models — email-sourced items
  // ("Found in your email") and Keel's own detector recommendations
  // ("Keel noticed") — plus renewals, the highest-urgency subset. The
  // filter chips name the taxonomy instead of leaving users to infer it
  // from the per-row labels.
  const [filter, setFilter] = useState<'all' | 'email' | 'keel' | 'renewals'>('all')
  // Server is the source of truth (the local store only knows about
  // connections made in this tab) — otherwise a connected, actively-syncing
  // mailbox still showed "Connect your email".
  const [serverEmail, setServerEmail] = useState<{
    connected: boolean
    needsReauth: boolean
  } | null>(null)
  const loadEmailStatus = useCallback(async () => {
    const status = await fetchEmailConnectorStatus()
    // A failed check must not overwrite a known-good status with "not
    // connected" (confirmed live: a dropped request during a dev-server
    // blip briefly showed "Connect your email" over an actually-connected,
    // needs-reauth mailbox) — leave whatever we last knew alone instead.
    if (!status.failed)
      setServerEmail({ connected: status.connected, needsReauth: status.needsReauth })
  }, [])
  useEffect(() => {
    loadEmailStatus()
  }, [loadEmailStatus])
  const emailConnected = (serverEmail?.connected ?? false) || connectedConnectors.includes('email')
  const needsReauth = emailConnected && !!serverEmail?.needsReauth

  // Live-verification finding: "Dismiss" (and the expanded panel's action
  // button) removes the row the user just pressed — including the button
  // itself — from the DOM entirely. Confirmed live with a real click:
  // document.activeElement fell to <body> afterward, with nothing telling
  // a keyboard/screen-reader user where the dismissed item went or that
  // anything happened. A stable, always-present live region that both
  // receives focus and announces which item was dismissed covers this
  // regardless of how many items remain (including down to zero, where
  // EmptyState takes over below it).
  const announceRef = useRef<HTMLDivElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const announceDismissal = useCallback((subject: string) => {
    setAnnouncement(`${subject} dismissed.`)
    announceRef.current?.focus()
  }, [])

  const loadInbox = useCallback(async () => {
    const result = await fetchInboxItems()
    setItems(result.items)
    setLoadError(result.failed)
    setLoading(false)
  }, [])

  const retryLoad = useCallback(() => {
    haptic('light')
    invalidateCache('inbox-items')
    setLoading(true)
    loadInbox()
    loadEmailStatus()
  }, [loadInbox, loadEmailStatus])

  useEffect(() => {
    loadInbox()
  }, [loadInbox])

  const unreadCount = items.filter((i) => !i.read).length

  // Keep the global store in sync so the tab bar badge updates without
  // fetching inbox items on every page navigation.
  useEffect(() => {
    setInboxUnreadCount(unreadCount)
  }, [unreadCount, setInboxUnreadCount])

  const handleScanNow = async () => {
    haptic('light')
    setScanning(true)
    const result = await scanEmailInbox()
    if (result) {
      haptic('success')
      // Without a message a scan that finds nothing looks like a dead button.
      toast({
        message:
          result.scanned === 0
            ? 'No new mail since the last check'
            : result.inboxItemsCreated > 0
              ? `Found ${result.inboxItemsCreated} new policy email${result.inboxItemsCreated === 1 ? '' : 's'}`
              : `Checked ${result.scanned} new email${result.scanned === 1 ? '' : 's'} — nothing about policies`,
      })
      await loadInbox()
    } else {
      haptic('warning')
      toast({ message: 'Could not check your mailbox right now', variant: 'error' })
    }
    setScanning(false)
  }

  const handleLookBack = async () => {
    haptic('light')
    setLookingBack(true)
    const result = await searchMailboxForPolicies(90)
    if (result) {
      haptic('success')
      toast({
        message:
          result.inboxItemsCreated > 0
            ? `Found ${result.inboxItemsCreated} policy email${result.inboxItemsCreated === 1 ? '' : 's'} from the last 90 days`
            : `Checked ${result.scanned} possible policy email${result.scanned === 1 ? '' : 's'} from the last 90 days — no policy details found`,
      })
      await loadInbox()
    } else {
      haptic('warning')
      toast({ message: 'Could not search your mailbox right now', variant: 'error' })
    }
    setLookingBack(false)
  }

  const handleTap = (id: string) => {
    haptic('light')
    const opening = expandedId !== id
    setExpandedId(opening ? id : null)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)))
    setPolicyError(null)
    const item = items.find((i) => i.id === id)
    setPolicyDraft(opening && item?.policy && !item.route ? toPolicyDraft(item.policy) : null)
  }

  const handleApplyPolicy = async (item: InboxItem) => {
    if (!policyDraft) return
    haptic('light')
    setPolicyApplying(true)
    setPolicyError(null)
    try {
      await applyInboxPolicy(item.id, {
        type: policyDraft.type,
        provider: policyDraft.provider.trim(),
        coverageAmountMinor: Math.round((Number(policyDraft.coverageAmount) || 0) * 100),
        monthlyPremiumMinor: Math.round((Number(policyDraft.monthlyPremium) || 0) * 100),
        ...(policyDraft.renewalDate ? { renewalDate: policyDraft.renewalDate } : {}),
        ...(policyDraft.policyNumber.trim()
          ? { policyNumber: policyDraft.policyNumber.trim() }
          : {}),
        ...(policyDraft.memberId ? { memberId: policyDraft.memberId } : {}),
        ...(policyDraft.contactPhone.trim()
          ? { contactPhone: policyDraft.contactPhone.trim() }
          : {}),
        ...(policyDraft.contactEmail.trim()
          ? { contactEmail: policyDraft.contactEmail.trim() }
          : {}),
      })
      haptic('success')
      setAppliedIds((prev) => new Set(prev).add(item.id))
    } catch (err) {
      haptic('warning')
      setPolicyError(
        err instanceof Error ? err.message : 'Could not add this policy to your Financial Profile',
      )
    } finally {
      setPolicyApplying(false)
    }
  }

  // Shared dismiss logic: remove the item visually, then buffer the
  // server-side/store commit behind an undo window.  If the user taps
  // "Undo" before the timer fires, the item comes back as if nothing
  // happened.
  const dismissWithUndo = useCallback(
    (item: InboxItem, feedbackLevel: 'success' | 'light') => {
      haptic(feedbackLevel)
      setExpandedId(null)

      // Visually remove immediately
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      announceDismissal(item.subject)

      // Schedule the permanent commit after the undo window
      const timer = setTimeout(() => {
        undoTimers.current.delete(item.id)
        dismissInboxItem(item.id)
      }, 5000)
      undoTimers.current.set(item.id, timer)

      toast({
        message: 'Dismissed',
        duration: 5000,
        onUndo: () => {
          clearTimeout(timer)
          undoTimers.current.delete(item.id)
          // Restore the item
          setItems((prev) => {
            if (prev.some((i) => i.id === item.id)) return prev
            return [...prev, item].sort((a, b) => (a.date < b.date ? 1 : -1))
          })
          haptic('light')
        },
      })
    },
    [toast, announceDismissal],
  )

  const handleAction = (item: InboxItem) => {
    // Keel's recommendations link to where the user can act on them; the
    // item stays until they dismiss it or the underlying gap is resolved.
    if (item.route) {
      haptic('light')
      router.push(item.route)
      return
    }
    dismissWithUndo(item, 'success')
  }

  const handleDismiss = (item: InboxItem) => {
    dismissWithUndo(item, 'light')
  }

  const FILTER_LABELS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'email', label: 'From email' },
    { key: 'keel', label: 'Keel noticed' },
    { key: 'renewals', label: 'Renewals' },
  ]
  const visibleItems = items.filter((item) => {
    if (filter === 'email') return item.source !== 'Keel'
    if (filter === 'keel') return item.source === 'Keel'
    if (filter === 'renewals') return item.actionType === 'renew'
    return true
  })

  return (
    <PageTransition>
      <PullToRefresh onRefresh={loadInbox}>
        <div className="px-5 pt-2 space-y-4">
          <PageHeader
            title="From Keel"
            subtitle="What Keel noticed — and what to do next"
            action={
              unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="text-xs font-bold text-white px-2 py-0.5 rounded-full"
                  style={{ background: '#f87171' }}
                >
                  {unreadCount}
                </motion.span>
              )
            }
          />

          {/* AI Summary banner */}
          {items.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <GlassCard className="p-4 border-family-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Bot size={18} className="text-family-400" />
                  <span className="text-sm font-semibold text-family-400">Keel's summary</span>
                </div>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  {unreadCount > 0
                    ? `Keel has ${unreadCount} ${unreadCount === 1 ? 'thing' : 'things'} for you to look at.`
                    : 'Nothing new — you have seen everything Keel has for you.'}
                </p>
              </GlassCard>
            </motion.div>
          )}

          {/* Email connected — manual rescan */}
          {emailConnected && !needsReauth && !loading && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <GlassCard className="p-4">
                <div className="flex items-start gap-3">
                  <Bot size={20} className="text-family-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-ink-secondary">Email connected</div>
                    <p className="text-xs text-ink-tertiary mt-0.5">
                      New mail is checked every 15 minutes. Keel only keeps insurance and policy
                      emails.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleScanNow}
                    disabled={scanning}
                    className="flex-1 justify-center text-xs font-semibold text-family-400 px-3 py-2.5 rounded-xl bg-family-500/10 active:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {scanning ? <Loader2 size={12} className="animate-spin" /> : null}
                    {scanning ? 'Scanning...' : 'Scan now'}
                  </button>
                  <button
                    onClick={handleLookBack}
                    disabled={lookingBack}
                    className="flex-1 justify-center text-xs font-semibold text-family-400 px-3 py-2.5 rounded-xl bg-family-500/10 active:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {lookingBack ? <Loader2 size={12} className="animate-spin" /> : null}
                    {lookingBack ? 'Searching…' : 'Find policies (90 days)'}
                  </button>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Email not connected / needs reconnecting banner */}
          {(!emailConnected || needsReauth) && !loading && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <GlassCard className="p-4 border-family-500/20 flex items-center gap-3">
                <Bot size={20} className="text-family-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-family-400">
                    {needsReauth ? 'Reconnect your email' : 'Connect your email'}
                  </div>
                  <p className="text-xs text-ink-tertiary mt-0.5">
                    {needsReauth
                      ? 'Google stopped our access to your mailbox, so new mail isn’t syncing. Reconnect to resume.'
                      : 'Get AI-summarized financial notifications automatically.'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    haptic('light')
                    router.push('/connect/email')
                  }}
                  className="text-xs font-semibold text-white px-3 py-2 rounded-xl bg-family-500/80 active:opacity-80"
                >
                  {needsReauth ? 'Reconnect' : 'Connect'}
                </button>
              </GlassCard>
            </motion.div>
          )}

          {/* Source filters — only worth showing once there's more than one
          item to sort through. */}
          {!loading && items.length >= 2 && (
            <div className="flex gap-2 -mx-5 px-5 overflow-x-auto no-scrollbar">
              {FILTER_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    haptic('light')
                    setFilter(key)
                  }}
                  aria-pressed={filter === key}
                  className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    filter === key
                      ? 'bg-family-500 text-white'
                      : 'bg-tint/[0.05] text-ink-secondary active:opacity-70'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <GlassCard key={i} className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-2xl flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}

          <div
            ref={announceRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="sr-only outline-none"
          >
            {announcement}
          </div>

          {/* Inbox items */}
          <div className="space-y-2">
            {items.length === 0 && loadError ? (
              <GlassCard>
                <EmptyState
                  icon={Bot}
                  title="Couldn't load your inbox"
                  description="Keel couldn't reach the server just now — this isn't the same as having nothing to show you. Check your connection and try again."
                  actionLabel="Try again"
                  onAction={retryLoad}
                />
              </GlassCard>
            ) : items.length === 0 ? (
              <GlassCard>
                <EmptyState
                  icon={Bot}
                  title="Nothing needs your attention"
                  description="Keel will post here when it spots a gap, a renewal, or policy details in your email."
                  {...(emailConnected
                    ? {}
                    : {
                        actionLabel: 'Connect email',
                        onAction: () => {
                          haptic('light')
                          router.push('/connect/email')
                        },
                      })}
                />
              </GlassCard>
            ) : visibleItems.length === 0 ? (
              <GlassCard className="p-5">
                <p className="text-sm text-ink-tertiary text-center">
                  Nothing in this view — try a different filter.
                </p>
              </GlassCard>
            ) : (
              visibleItems.map((item, i) => {
                const isExpanded = expandedId === item.id
                const color = priorityColor(item.priority)
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.06 }}
                  >
                    {/* Not `interactive` — that prop's own whileTap gesture on
                  this GlassCard's motion.div, nested directly inside
                  SwipeableRow's drag="x" motion.div, was winning Framer's
                  gesture-recognition race and blocking the parent's drag
                  from ever registering (confirmed live: taps worked, drags
                  never did, on a plain, correctly-configured drag prop). */}
                    <SwipeableRow
                      onDismiss={() => handleDismiss(item)}
                      disabled={isExpanded || dismissingId === item.id}
                    >
                      <GlassCard className="overflow-hidden">
                        <button
                          onClick={() => handleTap(item.id)}
                          aria-expanded={isExpanded}
                          aria-controls={`inbox-item-${item.id}-panel`}
                          className="w-full p-4 flex items-start gap-3 text-left"
                        >
                          <div
                            className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                            style={{ background: `${priorityColor(item.priority)}15` }}
                          >
                            {(() => {
                              const InboxIcon = INBOX_ICONS[item.id] ?? Info
                              return (
                                <InboxIcon
                                  size={18}
                                  color={priorityColor(item.priority)}
                                  strokeWidth={1.5}
                                />
                              )
                            })()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs text-ink-tertiary">
                                {item.source === 'Keel'
                                  ? 'Keel noticed'
                                  : `Found in your email${item.policy?.provider ? ` · ${item.policy.provider}` : ''}${item.threadCount ? ` · ${item.threadCount} messages` : ''}`}
                              </span>
                              {!item.read && (
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ background: color }}
                                />
                              )}
                              <span className="text-xs text-ink-tertiary ml-auto">
                                {formatRelativeDate(item.date)}
                              </span>
                            </div>
                            <div
                              className={`text-sm font-semibold ${item.read ? 'text-ink-secondary' : 'text-ink-primary'}`}
                            >
                              {item.subject}
                              {item.repeatCount !== undefined && item.repeatCount > 1 && (
                                <span className="ml-2 text-[10px] font-semibold text-amber-400/90 bg-amber-400/10 rounded-full px-1.5 py-0.5 align-middle">
                                  Flagged {item.repeatCount} times
                                </span>
                              )}
                              {item.actedOn && (
                                <span className="ml-2 text-[10px] font-semibold text-success/90 bg-success/10 rounded-full px-1.5 py-0.5 align-middle">
                                  Acted on
                                </span>
                              )}
                            </div>
                            {!isExpanded && (
                              <p className="text-xs text-ink-tertiary mt-1 line-clamp-2">
                                {/* KEEL-016: every item here is an LLM's read of an inbound
                            email — a small always-visible marker so that's clear
                            before the user ever taps in, not just in the expanded
                            "AI explains" panel below. */}
                                <Bot
                                  size={11}
                                  className="inline-block mr-1 -mt-0.5 text-ink-tertiary/70"
                                />
                                <MoneyText text={item.aiSummary} />
                              </p>
                            )}
                          </div>
                        </button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              id={`inbox-item-${item.id}-panel`}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4">
                                <div className="glass rounded-2xl p-3 mb-3">
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <Bot size={14} className="text-family-400" />
                                    <span className="text-xs font-semibold text-family-400">
                                      {item.source === 'Keel'
                                        ? 'Why Keel flagged this'
                                        : 'What the email says'}
                                    </span>
                                  </div>
                                  <p className="text-sm text-ink-secondary leading-relaxed">
                                    <MoneyText text={item.aiSummary} />
                                  </p>
                                  {item.policy && (
                                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                      {policyFacts(item.policy).map(([k, v]) => (
                                        <div key={k} className="contents">
                                          <dt className="text-ink-tertiary">{k}</dt>
                                          <dd className="text-ink-secondary font-medium">{v}</dd>
                                        </div>
                                      ))}
                                    </dl>
                                  )}
                                </div>
                                {item.policy && !item.route ? (
                                  appliedIds.has(item.id) ? (
                                    <div
                                      role="status"
                                      aria-live="polite"
                                      className="flex items-start gap-2 p-3 rounded-2xl bg-success/10 border border-success/20"
                                    >
                                      <CheckCircle2
                                        size={18}
                                        className="text-success flex-shrink-0 mt-0.5"
                                      />
                                      <p className="text-sm text-ink-secondary">
                                        Added to your Financial Profile.{' '}
                                        <button
                                          onClick={() => router.push('/financial-profile')}
                                          className="text-family-400 font-semibold"
                                        >
                                          Review your profile
                                        </button>
                                        .
                                      </p>
                                    </div>
                                  ) : policyDraft ? (
                                    <>
                                      <div className="text-xs text-ink-tertiary mb-3">
                                        Check these before adding — Keel filled them in from the
                                        email, especially the policy type.
                                      </div>
                                      <PolicyReviewForm
                                        draft={policyDraft}
                                        onChange={setPolicyDraft}
                                        onSubmit={() => handleApplyPolicy(item)}
                                        submitting={policyApplying}
                                        error={policyError}
                                        members={family?.members ?? []}
                                      />
                                      <button
                                        onClick={() => handleDismiss(item)}
                                        disabled={dismissingId === item.id}
                                        className="w-full mt-2 py-2 text-xs font-semibold text-ink-tertiary disabled:opacity-50"
                                      >
                                        Not now
                                      </button>
                                    </>
                                  ) : null
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <motion.button
                                      whileTap={{ scale: 0.95 }}
                                      onClick={() => handleAction(item)}
                                      className="flex-1 rounded-2xl py-3 text-sm font-semibold text-white"
                                      style={{ background: actionTypeColor(item.actionType) }}
                                    >
                                      {item.actionLabel}
                                    </motion.button>
                                    <motion.button
                                      whileTap={{ scale: 0.95 }}
                                      onClick={() => handleDismiss(item)}
                                      disabled={dismissingId === item.id}
                                      className="glass rounded-2xl px-4 py-3 text-sm font-semibold text-ink-tertiary disabled:opacity-50"
                                    >
                                      {dismissingId === item.id ? (
                                        <Loader2 size={14} className="animate-spin" />
                                      ) : (
                                        'Dismiss'
                                      )}
                                    </motion.button>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </GlassCard>
                    </SwipeableRow>
                  </motion.div>
                )
              })
            )}
          </div>

          {/* Referral prompt — the inbox is where Keel proves value, so it's the
          honest place to ask for a share. Snoozes 14 days on dismiss. */}
          {items.length > 0 && <ReferralPrompt />}

          <div className="glass rounded-2xl p-4 flex items-start gap-2">
            <Info size={18} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-ink-tertiary leading-relaxed">
              This isn’t your mailbox. Keel reads your connected email only for insurance and policy
              details, and ignores everything else. For information only — not advice.
            </p>
          </div>
        </div>
      </PullToRefresh>
    </PageTransition>
  )
}

const REFERRAL_SNOOZE_KEY = 'lifekeel_referral_prompt_snoozed'
const REFERRAL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

/** "Share Keel with another family" — shown at the bottom of the inbox,
 *  the moment the product has just demonstrated value (there are items
 *  to read). Dismiss snoozes 14 days so it can't nag. */
function ReferralPrompt() {
  const [code, setCode] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  useEffect(() => {
    try {
      const snoozed = Number(localStorage.getItem(REFERRAL_SNOOZE_KEY) ?? 0)
      if (Date.now() - snoozed < REFERRAL_SNOOZE_MS) return
    } catch {
      /* locked-down storage — show it anyway, dismiss just won't persist */
    }
    setVisible(true)
    fetchMyReferralCode().then(setCode)
  }, [])

  if (!visible) return null

  const link = code ? `${window.location.origin}/signup?ref=${code}` : null

  const share = async () => {
    if (!link) return
    haptic('light')
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'LifeKeel',
          text: "Check your family's readiness — free, about a minute.",
          url: link,
        })
        return
      } catch {
        /* user cancelled or unsupported — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ message: 'Couldn\u2019t copy the link', variant: 'error' })
    }
  }

  // WhatsApp is where families actually coordinate — a wa.me deep link puts
  // the referral URL straight into a WhatsApp compose window on any platform
  // (app on mobile, WhatsApp Web on desktop), unlike navigator.share which
  // is mobile-only and leaves desktop users at a clipboard.
  const whatsappShare = () => {
    if (!link) return
    haptic('light')
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`Check your family's readiness — free, about a minute: ${link}`)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  const snooze = () => {
    haptic('light')
    try {
      localStorage.setItem(REFERRAL_SNOOZE_KEY, String(Date.now()))
    } catch {}
    setVisible(false)
  }

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
          <Share2 size={16} className="text-family-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-primary">
            Know a family that should check theirs?
          </p>
          <p className="text-xs text-ink-tertiary mt-0.5 leading-relaxed">
            Share your link — when they join and finish setup, you both get 25 credits.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={share}
          disabled={!code}
          className="flex-1 rounded-2xl py-2.5 text-sm font-semibold text-white bg-family-500 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
          {copied ? 'Link copied' : 'Share your link'}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={whatsappShare}
          disabled={!code}
          title="Share on WhatsApp"
          aria-label="Share on WhatsApp"
          className="rounded-2xl px-3.5 py-2.5 text-sm font-semibold text-success bg-success/10 border border-success/20 disabled:opacity-50"
        >
          <MessageCircle size={16} />
        </motion.button>
        <button onClick={snooze} className="px-3 py-2.5 text-xs font-semibold text-ink-tertiary">
          Not now
        </button>
      </div>
    </div>
  )
}
