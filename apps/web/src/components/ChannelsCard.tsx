'use client'

/**
 * PRD-140 — how alerts reach you: which channels work, why push may be
 * unavailable on this device, and what happened to a device that stopped
 * receiving. Adults only (the API 403s children and the card then renders
 * nothing). Counts and plain words; no tokens, endpoints or amounts.
 */
import { useCallback, useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { fetchChannelState, type ChannelState } from '@/lib/api'
import { explainChannels, type ClientFacts } from '@/lib/channel-explain'
import { isIOS, isStandalone } from '@/lib/platform'
import { isNativeShell } from '@/lib/native'
import { isPushSupported, subscribeNativePush } from '@/lib/push'

// Module-level default — an inline arrow in the signature gets a new
// identity on every render, which made the mount effect below re-run in
// a loop and flood GET /family/channels (~360 requests from one open
// Settings tab; UAT P9).
const readDeviceFacts = (): ClientFacts => ({
  nativeShell: isNativeShell(),
  ios: isIOS(),
  standalone: isStandalone(),
  pushSupported: isPushSupported(),
})

export function ChannelsCard({
  loadState = fetchChannelState,
  readFacts = readDeviceFacts,
}: {
  loadState?: () => Promise<ChannelState | null>
  readFacts?: () => ClientFacts
}) {
  const [state, setState] = useState<ChannelState | null>(null)
  const [facts, setFacts] = useState<ClientFacts | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(() => loadState().then(setState), [loadState])

  useEffect(() => {
    setFacts(readFacts())
    void refresh()
  }, [refresh, readFacts])

  if (!state || !facts) return null
  const lines = explainChannels(state, facts)

  async function enableNative() {
    haptic('light')
    setBusy(true)
    setNote(null)
    const ok = await subscribeNativePush()
    setBusy(false)
    if (ok) await refresh()
    else setNote('Could not turn alerts on. Check that notifications are allowed for LifeKeel.')
  }

  return (
    <GlassCard className="p-4 mt-4">
      <div className="flex items-center gap-2">
        <Smartphone size={16} className="text-family-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-ink-primary">How alerts reach you</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <li key={l.key} className="text-xs text-ink-secondary leading-relaxed">
            {l.text}
            {l.action === 'enable_native' && (
              <button
                type="button"
                disabled={busy}
                onClick={enableNative}
                className="ml-2 rounded-lg bg-family-500/20 border border-family-500/30 px-2 py-1 text-xs font-semibold text-family-300 disabled:opacity-50"
              >
                {busy ? 'Turning on…' : 'Turn on alerts'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {note && (
        <p role="status" className="mt-2 text-xs text-danger">
          {note}
        </p>
      )}
    </GlassCard>
  )
}
