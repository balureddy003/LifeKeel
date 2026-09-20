'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Bot, Info, Home, Landmark, Wallet, Plane, CreditCard, Car, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, PageHeader, EmptyState, MoneyText, Skeleton, PageTransition } from '@/components/Glass'
import { PullToRefresh } from '@/components/PullToRefresh'
import { SwipeableRow } from '@/components/SwipeableRow'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import type { InboxItem } from '@/lib/onboarding-data'
import { fetchInboxItems, dismissInboxItem, scanEmailInbox, fetchConnectorStatuses } from '@/lib/api'
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
    update: '#a78bfa',
    info: '#8a8070',
  }
  return colors[type] ?? '#8a8070'
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
  ]
  return rows.filter((r): r is [string, string] => !!r[1])
}

export default function InboxPage() {
  const router = useRouter()
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
  // Server is the source of truth (the local store only knows about
  // connections made in this tab) — otherwise a connected, actively-syncing
  // mailbox still showed "Connect your email".
  const [serverEmail, setServerEmail] = useState<{ connected: boolean; needsReauth: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchConnectorStatuses().then((cs) => {
      const email = cs.find((c) => c.id === 'email')
      if (!cancelled) setServerEmail({ connected: !!email?.connected, needsReauth: !!email?.needsReauth })
    })
    return () => { cancelled = true }
  }, [])
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
    setLoading(false)
  }, [])

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
      await loadInbox()
    } else {
      haptic('warning')
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
        message: result.inboxItemsCreated > 0
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
    setExpandedId(expandedId === id ? null : id)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)))
  }

  // Shared dismiss logic: remove the item visually, then buffer the
  // server-side/store commit behind an undo window.  If the user taps
  // "Undo" before the timer fires, the item comes back as if nothing
  // happened.
  const dismissWithUndo = useCallback((item: InboxItem, feedbackLevel: 'success' | 'light') => {
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
  }, [toast, announceDismissal])

  const handleAction = (item: InboxItem) => {
    // Oak's recommendations link to where the user can act on them; the
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

  return (
    <PageTransition>
    <PullToRefresh onRefresh={loadInbox}>
    <div className="px-5 pt-2 space-y-4">
      <PageHeader
        title="From Oak"
        subtitle="What Oak noticed — and what to do next"
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
            <span className="text-sm font-semibold text-family-400">Oak's summary</span>
          </div>
          <p className="text-sm text-ink-secondary leading-relaxed">
            {unreadCount > 0
              ? `Oak has ${unreadCount} recommendation${unreadCount === 1 ? '' : 's'} for you to look at.`
              : 'Nothing new — you have seen everything Oak has for you.'}
          </p>
        </GlassCard>
      </motion.div>
      )}

      {/* Email connected — manual rescan */}
      {emailConnected && !needsReauth && !loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-4 flex items-center gap-3">
            <Bot size={20} className="text-family-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink-secondary">Email connected</div>
              <p className="text-xs text-ink-tertiary mt-0.5">New mail is checked every 15 minutes. Oak only keeps insurance and policy emails.</p>
            </div>
            <button
              onClick={handleScanNow}
              disabled={scanning}
              className="text-xs font-semibold text-family-400 px-3 py-2 rounded-xl bg-family-500/10 active:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
            >
              {scanning ? <Loader2 size={12} className="animate-spin" /> : null}
              {scanning ? 'Scanning...' : 'Scan now'}
            </button>
            <button
              onClick={handleLookBack}
              disabled={lookingBack}
              className="text-xs font-semibold text-family-400 px-3 py-2 rounded-xl bg-family-500/10 active:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
            >
              {lookingBack ? <Loader2 size={12} className="animate-spin" /> : null}
              {lookingBack ? 'Searching…' : 'Find policies (90 days)'}
            </button>
          </GlassCard>
        </motion.div>
      )}

      {/* Email not connected / needs reconnecting banner */}
      {(!emailConnected || needsReauth) && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlassCard className="p-4 border-family-500/20 flex items-center gap-3">
            <Bot size={20} className="text-family-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-family-400">{needsReauth ? 'Reconnect your email' : 'Connect your email'}</div>
              <p className="text-xs text-ink-tertiary mt-0.5">
                {needsReauth
                  ? 'Google stopped our access to your mailbox, so new mail isn’t syncing. Reconnect to resume.'
                  : 'Get AI-summarized financial notifications automatically.'}
              </p>
            </div>
            <button
              onClick={() => { haptic('light'); router.push('/connect/email') }}
              className="text-xs font-semibold text-white px-3 py-2 rounded-xl bg-family-500/80 active:opacity-80"
            >
              {needsReauth ? 'Reconnect' : 'Connect'}
            </button>
          </GlassCard>
        </motion.div>
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

      <div ref={announceRef} tabIndex={-1} role="status" aria-live="polite" className="sr-only outline-none">
        {announcement}
      </div>

      {/* Inbox items */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon={Bot}
              title="Nothing needs your attention"
              description="Oak will post here when it spots a gap, a renewal, or policy details in your email."
              {...(emailConnected ? {} : { actionLabel: 'Connect email', onAction: () => { haptic('light'); router.push('/connect/email') } })}
            />
          </GlassCard>
        ) : (
          items.map((item, i) => {
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
              <SwipeableRow onDismiss={() => handleDismiss(item)} disabled={isExpanded || dismissingId === item.id}>
              <GlassCard
                className="overflow-hidden"
              >
                <button
                  onClick={() => handleTap(item.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`inbox-item-${item.id}-panel`}
                  className="w-full p-4 flex items-start gap-3 text-left"
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${priorityColor(item.priority)}15` }}>
                    {(() => {
                      const InboxIcon = INBOX_ICONS[item.id] ?? Info
                      return <InboxIcon size={18} color={priorityColor(item.priority)} strokeWidth={1.5} />
                    })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-ink-tertiary">
                        {item.source === 'Oak'
                          ? 'Oak noticed'
                          : `Found in your email${item.policy?.provider ? ` · ${item.policy.provider}` : ''}${item.threadCount ? ` · ${item.threadCount} messages` : ''}`}
                      </span>
                      {!item.read && (
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      )}
                      <span className="text-xs text-ink-tertiary ml-auto">{formatRelativeDate(item.date)}</span>
                    </div>
                    <div className={`text-sm font-semibold ${item.read ? 'text-ink-secondary' : 'text-ink-primary'}`}>
                      {item.subject}
                    </div>
                    {!isExpanded && (
                      <p className="text-xs text-ink-tertiary mt-1 line-clamp-2">
                        {/* OAK-016: every item here is an LLM's read of an inbound
                            email — a small always-visible marker so that's clear
                            before the user ever taps in, not just in the expanded
                            "AI explains" panel below. */}
                        <Bot size={11} className="inline-block mr-1 -mt-0.5 text-ink-tertiary/70" />
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
                              {item.source === 'Oak' ? 'Why Oak flagged this' : 'What the email says'}
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
                            {dismissingId === item.id ? <Loader2 size={14} className="animate-spin" /> : 'Dismiss'}
                          </motion.button>
                        </div>
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

      <div className="glass rounded-2xl p-4 flex items-start gap-2">
        <Info size={18} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-tertiary leading-relaxed">
          This isn’t your mailbox. Oak reads your connected email only for insurance and policy details, and ignores everything else. For information only — not advice.
        </p>
      </div>
    </div>
    </PullToRefresh>
    </PageTransition>
  )
}
