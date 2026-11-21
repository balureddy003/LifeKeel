'use client'

import { Siren, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useMode } from '@/lib/mode-context'
import { haptic } from '@/lib/haptics'

/**
 * One calm, always-findable row on Home that opens Emergency mode in one tap.
 * It replaces the floating SOS pill: same one-tap reach from the first screen,
 * without sitting over everything. Words are plain: something has happened.
 */
export function EmergencyRow() {
  const { config, activateEmergency } = useMode()
  if (!config.showEmergencyButton) return null

  return (
    <button
      type="button"
      onClick={() => {
        haptic('heavy')
        activateEmergency()
      }}
      className="block min-h-[48px] w-full text-left"
    >
      <GlassCard className="p-0" interactive>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-danger/10 border border-danger/20">
            <Siren size={18} className="text-danger" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink-primary">Something has happened</div>
            <div className="text-xs text-ink-tertiary">First steps, one at a time</div>
          </div>
          <ChevronRight size={18} className="flex-shrink-0 text-ink-tertiary" aria-hidden="true" />
        </div>
      </GlassCard>
    </button>
  )
}
