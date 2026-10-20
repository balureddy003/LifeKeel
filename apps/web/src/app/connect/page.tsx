'use client'

import { DeletionReceiptCard } from '@/components/DeletionReceiptCard'
import { MAILBOX_DELETE_MESSAGE, MAILBOX_DELETE_TITLE } from '@/lib/deletion-receipt-copy'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, GlassCard, Skeleton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import {
  fetchConnectorStatuses,
  disconnectConnector,
  disconnectMailboxAndDelete,
  type DeletionReceipt,
  fetchConnectorSyncStatus,
  triggerConnectorBackfill,
  fetchOpenBankingAccounts,
  syncOpenBanking,
  type ConnectorStatus,
  type ConnectorSyncResource,
  type ExternalAccount,
} from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import {
  Mail,
  Landmark,
  Check,
  Loader2,
  Unlink,
  Shield,
  Lock,
  Clock,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const CONNECTOR_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  'open-banking': Landmark,
}

const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
  email:
    'Connect any email provider — Gmail, Outlook, Yahoo, iCloud, or a custom domain — to import financial documents automatically. Free on every plan. AI summaries in plain language are a paid upgrade.',
  'open-banking':
    'Read-only bank account connections — Keel can see account types and balances, never move money. Full bank consent flow arrives with our regulated partner.',
}

const CONNECTOR_CATEGORIES: Record<string, { label: string; icon: LucideIcon }> = {
  email: { label: 'Email', icon: Mail },
  bank: { label: 'Banking', icon: Landmark },
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Sync/backfill status for a connected connector (remediation item 21) —
 * POST /connectors/:id/backfill and GET /connectors/:id/sync/status
 * already existed server-side with no caller, so a stalled or failed sync
 * was invisible to the user. Polls while a backfill is in flight.
 */
function ConnectorSyncPanel({ connectorId }: { connectorId: string }) {
  const [resources, setResources] = useState<ConnectorSyncResource[] | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      const next = await fetchConnectorSyncStatus(connectorId)
      if (cancelled) return
      setResources(next)
      // Keep polling while any resource reports an unfinished backfill.
      if (next.length > 0 && next.some((r) => !r.backfill_complete)) {
        timer = setTimeout(poll, 5000)
      }
    }
    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [connectorId, triggering])

  const handleResync = async () => {
    haptic('light')
    setTriggering(true)
    setFailed(false)
    const ok = await triggerConnectorBackfill(connectorId)
    if (!ok) setFailed(true)
    // Toggling `triggering` re-runs the effect above, restarting the poll.
    setTriggering(false)
  }

  if (resources === null) return null

  const totalSynced = resources.reduce((sum, r) => sum + (r.total_records_synced ?? 0), 0)
  const lastSync =
    resources
      .map((r) => r.last_synced_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  const inProgress = resources.some((r) => !r.backfill_complete)
  const lastError = resources
    .map((r) => r.last_error)
    .filter(Boolean)
    .at(-1)

  return (
    <div className="mt-2 space-y-1.5">
      {resources.length === 0 ? (
        <p className="text-xs text-ink-tertiary">
          Nothing synced yet — statements and renewals will appear here once the first sync
          completes.
        </p>
      ) : (
        <p className="text-xs text-ink-tertiary">
          {inProgress ? 'Syncing… ' : ''}
          {totalSynced} record{totalSynced === 1 ? '' : 's'} synced · last sync {timeAgo(lastSync)}
        </p>
      )}
      {lastError && (
        <p role="status" aria-live="polite" className="text-xs text-danger">
          Last sync didn't finish{lastError.status_text ? ` — ${lastError.status_text}` : ''} (
          {timeAgo(lastError.at)}). Already-synced data is unaffected.
        </p>
      )}
      {failed && (
        <p role="status" aria-live="polite" className="text-xs text-danger">
          The re-sync didn't start — try again in a moment.
        </p>
      )}
      <button
        type="button"
        onClick={handleResync}
        disabled={triggering || inProgress}
        className="flex items-center gap-1.5 text-xs font-semibold text-family-400 disabled:opacity-50"
      >
        {triggering || inProgress ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <RefreshCw size={12} />
        )}
        {inProgress ? 'Sync in progress' : 'Re-sync now'}
      </button>
    </div>
  )
}

/** PRD-133: the synced account list + manual re-sync for the read-only
 *  account-info connector (no platform sync-definition, so the generic
 *  ConnectorSyncPanel doesn't apply). */
function OpenBankingPanel() {
  const [accounts, setAccounts] = useState<ExternalAccount[] | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setAccounts(await fetchOpenBankingAccounts())
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const resync = async () => {
    haptic('light')
    setSyncing(true)
    await syncOpenBanking()
    await load()
    setSyncing(false)
  }

  const typeLabel: Record<string, string> = {
    current: 'Current',
    savings: 'Savings',
    credit: 'Credit',
    mortgage: 'Mortgage',
    investment: 'Investment',
    other: 'Account',
  }

  return (
    <div className="mt-2 space-y-1.5">
      {accounts === null ? (
        <Skeleton className="h-3.5 w-40" />
      ) : accounts.length === 0 ? (
        <p className="text-xs text-ink-tertiary">No accounts synced yet.</p>
      ) : (
        accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between text-xs">
            <span className="text-ink-secondary truncate">{a.name}</span>
            <span className="text-ink-tertiary whitespace-nowrap ml-2">
              {typeLabel[a.type] ?? 'Account'}
              {a.provider === 'sandbox' ? ' · demo' : ''}
            </span>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={resync}
        disabled={syncing}
        className="flex items-center gap-1.5 text-xs font-semibold text-family-400 disabled:opacity-50"
      >
        {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )
}

export default function ConnectPage() {
  const router = useRouter()
  const confirm = useConfirm()
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const connectedConnectors = useAppStore((s) => s.connectedConnectors)
  const setConnectorConnected = useAppStore((s) => s.setConnectorConnected)

  const loadConnectors = useCallback(async () => {
    const statuses = await fetchConnectorStatuses()
    setConnectors(statuses)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadConnectors()
  }, [loadConnectors])

  const handleConnect = (connectorId: string) => {
    haptic('light')
    if (connectorId === 'email') {
      router.push('/connect/email')
      return
    }
    if (connectorId === 'open-banking') {
      router.push('/connect/open-banking')
      return
    }
    setError(`${connectorId} isn't available to connect yet.`)
  }

  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null)

  const handleMailboxDeleteDisconnect = async (connectorId: string) => {
    haptic('warning')
    setConnectingId(connectorId)
    const r = await disconnectMailboxAndDelete(connectorId)
    if (r) {
      setConnectorConnected('email', false)
      setConnectorConnected('gmail', false)
      setReceipt(r)
      haptic('success')
    } else {
      setError(
        `${connectorId} is still connected — the disconnect didn't go through. Try again in a moment.`,
      )
    }
    setConnectingId(null)
  }

  const handleDisconnect = async (connectorId: string) => {
    haptic('warning')
    setConnectingId(connectorId)
    const success = await disconnectConnector(connectorId)
    if (success) {
      setConnectorConnected(connectorId, false)
      haptic('success')
    } else {
      setError(
        `${connectorId} is still connected — the disconnect didn't go through. Try again in a moment.`,
      )
    }
    setConnectingId(null)
  }

  const grouped = CONNECTOR_CATEGORIES
  const categoryKeys = Object.keys(grouped)

  return (
    <div className="px-5 pt-2 space-y-4">
      <PageHeader title="Connect Services" backHref="/settings" />

      {receipt && <DeletionReceiptCard receipt={receipt} />}

      {/* Privacy banner */}
      <GlassCard className="p-3.5 border-family-500/20 flex items-start gap-2">
        <Shield size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-secondary leading-relaxed">
          Connections are read-only. Passwords and access tokens you enter are encrypted before they
          are stored, and you can disconnect at any time.
        </p>
      </GlassCard>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <GlassCard className="p-3.5 border-danger/20">
              <p className="text-xs text-ink-secondary">{error}</p>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <GlassCard key={i} className="p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="h-10 w-10 rounded-2xl flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-7 w-24 mt-1" />
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Connector groups */}
      {!loading &&
        categoryKeys.map((catKey) => {
          const cat = grouped[catKey]
          if (!cat) return null
          const CatIcon = cat.icon
          const catConnectors = connectors.filter((c) => c.category === catKey)
          if (catConnectors.length === 0) return null

          return (
            <div key={catKey} className="space-y-2">
              <div className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-secondary">
                <CatIcon size={16} className="text-ink-tertiary" />
                {cat.label}
              </div>

              {catConnectors.map((connector, i) => {
                const Icon = CONNECTOR_ICONS[connector.id] ?? Shield
                const isConnected =
                  connectedConnectors.includes(connector.id) || connector.connected
                const isConnecting = connectingId === connector.id

                return (
                  <motion.div
                    key={connector.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                  >
                    <GlassCard className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-tint/[0.05] flex items-center justify-center flex-shrink-0">
                          <Icon
                            size={18}
                            className={isConnected ? 'text-success' : 'text-ink-secondary'}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{connector.name}</span>
                            {isConnected && (
                              <span className="flex items-center gap-1 text-xs text-success">
                                <Check size={12} /> Connected
                              </span>
                            )}
                            {!isConnected && connector.comingSoon && (
                              <span className="flex items-center gap-1 text-xs text-ink-tertiary bg-tint/[0.05] px-2 py-0.5 rounded-full">
                                <Clock size={11} /> Coming soon
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-ink-tertiary mt-1 leading-relaxed">
                            {CONNECTOR_DESCRIPTIONS[connector.id] ??
                              'Connect this service to enhance your family profile.'}
                          </p>

                          <div className="mt-3">
                            {isConnected ? (
                              <motion.button
                                whileTap={{ scale: 0.96 }}
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: `Disconnect ${connector.name}?`,
                                    message: `You'll need to reconnect it to keep using its data.`,
                                    confirmLabel: 'Disconnect',
                                    destructive: true,
                                  })
                                  if (!ok) return
                                  if (connector.id === 'email' || connector.id === 'gmail') {
                                    // PRD-146: a plain disconnect keeps what was read, so ask.
                                    const wipe = await confirm({
                                      title: MAILBOX_DELETE_TITLE,
                                      message: MAILBOX_DELETE_MESSAGE,
                                      confirmLabel: 'Delete what was read',
                                      cancelLabel: 'Keep it',
                                      destructive: true,
                                    })
                                    if (wipe) {
                                      void handleMailboxDeleteDisconnect(connector.id)
                                      return
                                    }
                                  }
                                  handleDisconnect(connector.id)
                                }}
                                disabled={isConnecting}
                                className="flex items-center gap-1.5 text-xs font-semibold text-danger px-3 py-2 rounded-xl bg-danger/10 disabled:opacity-50"
                              >
                                {isConnecting ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Unlink size={14} />
                                )}
                                Disconnect
                              </motion.button>
                            ) : connector.comingSoon ? (
                              <Link
                                href="/financial-profile"
                                onClick={() => haptic('light')}
                                className="flex items-center gap-1 text-xs font-semibold text-family-400"
                              >
                                Add it manually instead <ChevronRight size={12} />
                              </Link>
                            ) : (
                              <motion.button
                                whileTap={{ scale: 0.96 }}
                                onClick={() => handleConnect(connector.id)}
                                disabled={isConnecting}
                                className="flex items-center gap-1.5 text-xs font-semibold text-white px-4 py-2 rounded-xl bg-family-500/80 disabled:opacity-50"
                              >
                                {isConnecting ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Lock size={14} />
                                )}
                                {isConnecting ? 'Connecting...' : 'Connect'}
                              </motion.button>
                            )}
                          </div>

                          {isConnected && connector.id === 'open-banking' && <OpenBankingPanel />}
                          {isConnected && connector.id !== 'open-banking' && (
                            <ConnectorSyncPanel connectorId={connector.id} />
                          )}
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                )
              })}
            </div>
          )
        })}
    </div>
  )
}
