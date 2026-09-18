'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton } from '@/components/Glass'
import { GoogleIcon } from '@/components/GoogleIcon'
import { PasswordInput } from '@/components/PasswordInput'
import { haptic } from '@/lib/haptics'
import { useAppStore } from '@/lib/store'
import { connectEmail, scanEmailInbox, startGmailOAuth, EMAIL_PROVIDER_OPTIONS } from '@/lib/api'

export default function ConnectEmailPage() {
  const router = useRouter()
  const setConnectorConnected = useAppStore((s) => s.setConnectorConnected)
  const [providerId, setProviderId] = useState('gmail')
  const [showManualGmail, setShowManualGmail] = useState(false)
  const manualEmailRef = useRef<HTMLInputElement>(null)

  // Live-verification finding: "Trouble signing in?" is a one-shot reveal —
  // clicking it removes the button itself from the DOM (replaced by a
  // divider) while the manual form appears further down. React doesn't
  // move focus when a focused element unmounts, so it silently fell back
  // to <body>: a keyboard/screen-reader user lost their place entirely and
  // had no way to discover the form that just appeared without re-exploring
  // the whole page from the top. Move focus to the form's first field
  // instead, the same way a newly-opened dialog would.
  useEffect(() => {
    if (showManualGmail) manualEmailRef.current?.focus()
  }, [showManualGmail])
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [googleConnecting, setGoogleConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ scanned: number; inboxItemsCreated: number } | null>(null)

  const provider = EMAIL_PROVIDER_OPTIONS.find((p) => p.id === providerId)
  const isCustom = providerId === 'custom'
  // Gmail's IMAP fallback needs an App Password — real friction for a
  // non-technical audience sitting right next to the one-click OAuth button
  // that makes it unnecessary. Keep it available but opt-in, not default-visible.
  const showManualForm = providerId !== 'gmail' || showManualGmail

  // Round trip from the Gmail OAuth flow (startGmailOAuth → Google's consent
  // screen → apps/api's /connectors/gmail/oauth/callback) lands back here as
  // a plain redirect with query params, not a client-side action — read them
  // via window.location rather than useSearchParams(), which needs a
  // Suspense boundary on a statically-exported page (see upgrade/page.tsx
  // for the same pattern already used elsewhere in this app).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'email') {
      const email = params.get('email')
      if (email) setUsername(email)
      setConnectorConnected('email', true)
      setConnected(true)
    } else if (params.get('connect') === 'gmail' && params.get('error')) {
      setError(`Google sign-in didn't complete: ${params.get('error')}`)
    }
  }, [setConnectorConnected])

  const handleGoogleConnect = async () => {
    haptic('light')
    setError(null)
    setGoogleConnecting(true)
    try {
      const url = await startGmailOAuth()
      window.location.href = url
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Could not start Google sign-in.')
      setGoogleConnecting(false)
    }
  }

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
          <div role="status" aria-live="polite">
            <GlassCard className="p-4">
              <div className="text-sm text-ink-secondary">
                Scanned {scanResult.scanned} message{scanResult.scanned === 1 ? '' : 's'}, found{' '}
                {scanResult.inboxItemsCreated} financially relevant.
              </div>
            </GlassCard>
          </div>
        ) : (
          <GlassButton onClick={handleScanNow} disabled={scanning} variant="secondary">
            {scanning ? <Loader2 size={18} className="animate-spin" /> : 'Scan now'}
          </GlassButton>
        )}

        {error && (
          <div role="status" aria-live="polite">
            <GlassCard className="p-4 border-danger/20 flex items-start gap-3">
              <AlertCircle size={20} className="text-danger flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink-secondary">{error}</div>
            </GlassCard>
          </div>
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
              aria-pressed={providerId === p.id}
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
        {providerId === 'gmail' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4">
            <button
              type="button"
              onClick={handleGoogleConnect}
              disabled={googleConnecting}
              className="w-full glass rounded-2xl py-4 flex items-center justify-center gap-2.5 text-base font-semibold text-ink-primary disabled:opacity-60"
            >
              {googleConnecting ? <Loader2 size={20} className="animate-spin" /> : <GoogleIcon size={20} />}
              {googleConnecting ? 'Redirecting to Google…' : 'Continue with Google'}
            </button>
            {!showManualGmail && (
              <button
                type="button"
                onClick={() => { haptic('light'); setShowManualGmail(true) }}
                className="w-full text-center text-xs text-ink-tertiary underline underline-offset-2"
              >
                Trouble signing in with Google? Connect manually instead
              </button>
            )}
            {showManualGmail && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/[0.08]" />
                <span className="text-xs text-ink-tertiary">or connect manually</span>
                <div className="h-px flex-1 bg-white/[0.08]" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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

      {showManualForm && (
        <>
          <GlassCard className="p-4 space-y-3">
            <label htmlFor="imap-email" className="block">
              <div className="text-xs text-ink-tertiary mb-1.5">Email address</div>
              <input
                id="imap-email"
                ref={manualEmailRef}
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder="you@example.com"
                autoComplete="email"
                className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
              />
            </label>
            <div>
              <label htmlFor="imap-password" className="block text-xs text-ink-tertiary mb-1.5">Password</label>
              <PasswordInput
                id="imap-password"
                value={password}
                onChange={setPassword}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder="••••••••••••"
                autoComplete="current-password"
                inputClassName="glass-input w-full rounded-xl px-4 py-3 pr-11 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
              />
            </div>
            {provider && (
              <p className="text-xs text-ink-tertiary leading-relaxed">{provider.passwordHint}</p>
            )}
          </GlassCard>

          {error && (
            <div role="status" aria-live="polite">
              <GlassCard className="p-4 border-danger/20 flex items-start gap-3">
                <AlertCircle size={20} className="text-danger flex-shrink-0 mt-0.5" />
                <div className="text-sm text-ink-secondary">{error}</div>
              </GlassCard>
            </div>
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
        </>
      )}
    </div>
  )
}
