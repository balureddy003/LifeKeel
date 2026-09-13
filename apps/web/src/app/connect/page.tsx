'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, GlassCard } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { fetchConnectorStatuses, disconnectConnector, type ConnectorStatus } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Mail, Landmark, Check, Loader2, Unlink, Shield, Lock, Clock, ChevronRight } from 'lucide-react'
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

export default function ConnectPage() {
  const router = useRouter()
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
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-ink-tertiary" />
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
                              onClick={() => {
                                if (!window.confirm(`Disconnect ${connector.name}? You'll need to reconnect it to keep using its data.`)) return
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
