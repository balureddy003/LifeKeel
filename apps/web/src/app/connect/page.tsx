'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, GlassCard, Skeleton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { fetchConnectorStatuses, disconnectConnector, fetchConnectorSyncStatus, triggerConnectorBackfill, type ConnectorStatus, type ConnectorSyncResource } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import { Mail, Landmark, Check, Loader2, Unlink, Shield, Lock, Clock, ChevronRight, RefreshCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const CONNECTOR_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  'open-banking': Landmark,
}

const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
  email: 'Connect any email provider — Gmail, Outlook, Yahoo, iCloud, or a custom domain — to import financial documents automatically. Free on every plan. AI summaries in plain language are a paid upgrade.',
  'open-banking': "We're working on secure bank account connections through a regulated banking partner. In the meantime, add your numbers directly in your Financial Profile to get personalized insights today.",
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
  const lastSync = resources.map((r) => r.last_synced_at).filter(Boolean).sort().at(-1) ?? null
  const inProgress = resources.some((r) => !r.backfill_complete)
  const lastError = resources.map((r) => r.last_error).filter(Boolean).at(-1)

  return (
    <div className="mt-2 space-y-1.5">
      {resources.length === 0 ? (
        <p className="text-xs text-ink-tertiary">No documents synced yet.</p>
      ) : (
        <p className="text-xs text-ink-tertiary">
          {inProgress ? 'Syncing… ' : ''}{totalSynced} record{totalSynced === 1 ? '' : 's'} synced · last sync {timeAgo(lastSync)}
        </p>
      )}
      {lastError && (
        <p role="status" aria-live="polite" className="text-xs text-danger">
          Last sync failed{lastError.status_text ? `: ${lastError.status_text}` : ''} ({timeAgo(lastError.at)})
        </p>
      )}
      {failed && (
        <p role="status" aria-live="polite" className="text-xs text-danger">Couldn't start a re-sync — try again.</p>
      )}
      <button
        type="button"
        onClick={handleResync}
        disabled={triggering || inProgress}
        className="flex items-center gap-1.5 text-xs font-semibold text-family-400 disabled:opacity-50"
      >
        {triggering || inProgress ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {inProgress ? 'Sync in progress' : 'Re-sync now'}
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
    setError(`${connectorId} isn't available to connect yet.`)
  }

  const handleDisconnect = async (connectorId: string) => {
    haptic('warning')
    setConnectingId(connectorId)
    const success = await disconnectConnector(connectorId)
    if (success) {
      setConnectorConnected(connectorId, false)
      haptic('success')
    } else {
      setError(`Failed to disconnect ${connectorId}. Please try again.`)
    }
    setConnectingId(null)
  }

  const grouped = CONNECTOR_CATEGORIES
  const categoryKeys = Object.keys(grouped)

  return (
    <div className="px-5 pt-2 space-y-4">
      <PageHeader title="Connect Services" backHref="/settings" />

      {/* Privacy banner */}
      <GlassCard className="p-3.5 border-family-500/20 flex items-start gap-2">
        <Shield size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-secondary leading-relaxed">
          We use bank-grade encryption and read-only access. We never store your passwords, and you can revoke access at any time.
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
      {!loading && categoryKeys.map((catKey) => {
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
              const isConnected = connectedConnectors.includes(connector.id) || connector.connected
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
                      <div className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center flex-shrink-0">
                        <Icon size={18} className={isConnected ? 'text-success' : 'text-ink-secondary'} />
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
                            <span className="flex items-center gap-1 text-xs text-ink-tertiary bg-white/[0.05] px-2 py-0.5 rounded-full">
                              <Clock size={11} /> Coming soon
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink-tertiary mt-1 leading-relaxed">
                          {CONNECTOR_DESCRIPTIONS[connector.id] ?? 'Connect this service to enhance your family profile.'}
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
                                handleDisconnect(connector.id)
                              }}
                              disabled={isConnecting}
                              className="flex items-center gap-1.5 text-xs font-semibold text-danger px-3 py-2 rounded-xl bg-danger/10 disabled:opacity-50"
                            >
                              {isConnecting ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
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
                              {isConnecting ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                              {isConnecting ? 'Connecting...' : 'Connect'}
                            </motion.button>
                          )}
                        </div>

                        {isConnected && <ConnectorSyncPanel connectorId={connector.id} />}
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