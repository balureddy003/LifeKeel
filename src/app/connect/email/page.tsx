'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useAppStore } from '@/lib/store'
import { connectEmail, scanEmailInbox, EMAIL_PROVIDER_OPTIONS } from '@/lib/api'

export default function ConnectEmailPage() {
  const router = useRouter()
  const setConnectorConnected = useAppStore((s) => s.setConnectorConnected)
  const [providerId, setProviderId] = useState('gmail')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ scanned: number; inboxItemsCreated: number } | null>(null)

  const provider = EMAIL_PROVIDER_OPTIONS.find((p) => p.id === providerId)
  const isCustom = providerId === 'custom'

  const handleConnect = async () => {
    haptic('light')
    setError(null)
    setConnecting(true)

    const result = await connectEmail({
      provider: providerId,
      ...(isCustom ? { host, port: Number(port) || 993 } : {}),
      username,
      password,
    })

    if (result.ok) {
      haptic('success')
      setConnectorConnected('email', true)
      setConnected(true)
    } else {
      haptic('warning')
      setError(result.error)
    }
    setConnecting(false)
  }

  const handleScanNow = async () => {
    haptic('light')
    setScanning(true)
    const result = await scanEmailInbox()
    if (result) {
      haptic('success')
      setScanResult({ scanned: result.scanned, inboxItemsCreated: result.inboxItemsCreated })
    } else {
      haptic('warning')
      setError('Scan failed — please try again in a moment.')
    }
    setScanning(false)
  }

  if (connected) {
    return (
      <div className="px-5 pt-2 pb-10 space-y-4">
        <PageHeader title="Email Connected" backHref="/connect" />
        <GlassCard className="p-4 border-success/20 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
          <div className="text-sm text-ink-secondary">
            {username} is connected. We're scanning your inbox in the background — financial emails will start
            showing up in your Inbox shortly.
          </div>
        </GlassCard>

        {scanResult ? (
          <GlassCard className="p-4">
            <div className="text-sm text-ink-secondary">
              Scanned {scanResult.scanned} message{scanResult.scanned === 1 ? '' : 's'}, found{' '}
              {scanResult.inboxItemsCreated} financially relevant.
            </div>
          </GlassCard>
        ) : (
          <GlassButton onClick={handleScanNow} disabled={scanning} variant="secondary">
            {scanning ? <Loader2 size={18} className="animate-spin" /> : 'Scan now'}
          </GlassButton>
        )}

        {error && (
          <GlassCard className="p-4 border-danger/20 flex items-start gap-3">
            <AlertCircle size={20} className="text-danger flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink-secondary">{error}</div>
          </GlassCard>
        )}

        <GlassButton onClick={() => router.push('/inbox')}>Go to Inbox</GlassButton>
      </div>
    )
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader title="Connect Email" backHref="/connect" subtitle="Works with any provider — not just Gmail" />

      <GlassCard className="p-4">
        <div className="text-sm font-semibold text-ink-secondary mb-3">Provider</div>
        <div className="grid grid-cols-2 gap-2">
          {EMAIL_PROVIDER_OPTIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { haptic('light'); setProviderId(p.id) }}
              className={`rounded-xl py-2.5 px-3 text-sm font-semibold text-left transition-all ${
                providerId === p.id ? 'bg-family-500 text-white' : 'glass text-ink-secondary'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </GlassCard>

      <AnimatePresence>
        {isCustom && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <GlassCard className="p-4 space-y-3">
              <label className="block">
                <div className="text-xs text-ink-tertiary mb-1.5">IMAP host</div>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="mail.example.com"
                  className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                />
              </label>
              <label className="block">
                <div className="text-xs text-ink-tertiary mb-1.5">Port</div>
                <input
                  type="number"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="993"
                  className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                />
              </label>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      <GlassCard className="p-4 space-y-3">
        <label className="block">
          <div className="text-xs text-ink-tertiary mb-1.5">Email address</div>
          <input
            type="email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="you@example.com"
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <label className="block">
          <div className="text-xs text-ink-tertiary mb-1.5">Password</div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        {provider && (
          <p className="text-xs text-ink-tertiary leading-relaxed">{provider.passwordHint}</p>
        )}
      </GlassCard>

      {error && (
        <GlassCard className="p-4 border-danger/20 flex items-start gap-3">
          <AlertCircle size={20} className="text-danger flex-shrink-0 mt-0.5" />
          <div className="text-sm text-ink-secondary">{error}</div>
        </GlassCard>
      )}

      <div className="glass rounded-2xl p-4 flex items-start gap-2">
        <ShieldCheck size={16} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-tertiary leading-relaxed">
          Your password is encrypted at rest and used only to read your inbox over a secure connection (IMAP).
          We test the connection before saving anything.
        </p>
      </div>

      <GlassButton
        onClick={handleConnect}
        disabled={connecting || !username || !password || (isCustom && (!host || !port))}
      >
        {connecting ? <Loader2 size={18} className="animate-spin" /> : 'Connect'}
      </GlassButton>
    </div>
  )
}
