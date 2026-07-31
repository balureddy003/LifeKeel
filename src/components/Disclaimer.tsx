'use client'

import { Info } from 'lucide-react'

const DISCLAIMER_TEXT =
  'For informational and educational purposes only. Not financial, investment, tax, or insurance advice. Consult a qualified professional before making financial decisions.'

export function DisclaimerBanner({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-[10px] leading-relaxed text-ink-tertiary px-4 py-2 text-center">
        {DISCLAIMER_TEXT}
      </p>
    )
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] px-4 py-3 flex items-start gap-2">
      <Info size={14} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
      <p className="text-xs leading-relaxed text-ink-tertiary">{DISCLAIMER_TEXT}</p>
    </div>
  )
}

export function DisclaimerFooter() {
  return (
    <footer className="px-4 py-3 text-center safe-area-bottom">
      <p className="text-[10px] leading-relaxed text-ink-tertiary/60">
        {DISCLAIMER_TEXT}
      </p>
    </footer>
  )
}

export { DISCLAIMER_TEXT }
