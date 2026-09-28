'use client'

/**
 * /connect/open-banking (PRD-133) — connect the read-only account-info
 * connector. Two providers: 'sandbox' (demo accounts for exercising the
 * pipeline) and 'truelayer' (a consented access token — the OAuth consent
 * flow that mints one is the partnership-dependent piece). Read-only: no
 * payment initiation exists anywhere in this path.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, Loader2, ShieldCheck } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import { connectOpenBanking } from '@/lib/api'

export default function ConnectOpenBankingPage() {
  const router = useRouter()
  const toast = useToast()
  const [provider, setProvider] = useState<'sandbox' | 'truelayer'>('truelayer')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    haptic('light')
    setBusy(true)
    const res = await connectOpenBanking(provider, provider === 'truelayer' ? token.trim() : undefined)
    setBusy(false)
    if (!res.ok) {
      haptic('warning')
      toast({ message: res.error, variant: 'error' })
      return
    }
    haptic('success')
    toast({ message: `Connected — ${res.accounts} account${res.accounts === 1 ? '' : 's'} found`, variant: 'success' })
    router.push('/connect')
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader title="Open Banking" backHref="/connect" subtitle="Read-only account information" />

      <GlassCard className="p-3.5 border-family-500/20 flex items-start gap-2">
        <ShieldCheck size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-secondary leading-relaxed">
          This connection is read-only — it can list your accounts, never move money. The full bank consent flow arrives with our regulated partner.
        </p>
      </GlassCard>

      <GlassCard className="p-4 space-y-4">
        <div className="space-y-2">
          {(
            [
              { id: 'truelayer' as const, label: 'TrueLayer', hint: 'Paste an access token from a TrueLayer sandbox or consented grant' },
              { id: 'sandbox' as const, label: 'Demo bank', hint: 'Fake accounts for trying the feature — nothing real is read' },
            ]
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { haptic('light'); setProvider(p.id) }}
              aria-pressed={provider === p.id}
              className={`w-full text-left rounded-xl p-3.5 border transition-colors ${
                provider === p.id
                  ? 'bg-family-500/15 border-family-500/40'
                  : 'bg-tint/[0.03] border-tint/10'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Landmark size={16} className={provider === p.id ? 'text-family-400' : 'text-ink-tertiary'} />
                <span className="text-sm font-semibold">{p.label}</span>
              </div>
              <p className="text-xs text-ink-tertiary mt-1 ml-6">{p.hint}</p>
            </button>
          ))}
        </div>

        {provider === 'truelayer' && (
          <div className="space-y-1.5">
            <label htmlFor="ob-token" className="text-xs font-medium text-ink-secondary">Access token</label>
            <input
              id="ob-token"
              type="password"
              autoComplete="off"
              placeholder="eyJ…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 transition-all font-mono"
            />
            <p className="text-xs text-ink-tertiary">
              Stored encrypted, used only to read your account list. Without a configured partner this returns a clear error.
            </p>
          </div>
        )}

        <GlassButton
          variant="secondary"
          onClick={connect}
          disabled={busy || (provider === 'truelayer' && !token.trim())}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Landmark size={16} />}
          <span>{busy ? 'Connecting…' : 'Connect'}</span>
        </GlassButton>
      </GlassCard>
    </div>
  )
}
