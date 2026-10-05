'use client'

import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { emergencyNumberFor } from '@/lib/emergency-numbers'

/**
 * "If anyone is in immediate danger, call X now" — shown, unconditionally,
 * above the fold, everywhere LifeKeel's crisis flows start (Emergency
 * Mode, the life-events list, an individual playbook). Every one of those
 * places used to hardcode "call 911" regardless of the signed-in family's
 * actual country — found live against a real UK account. Localizes to the
 * number for `user.country` (from /auth/me); falls back to a neutral,
 * still-correct phrasing (112, which works from most mobile phones
 * worldwide, plus 911 named since it's widely known) when country isn't
 * on file yet, rather than asserting a specific number that might be wrong.
 */
export function LifeSafetyNotice({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth()
  const emergency = emergencyNumberFor(user?.country)

  if (compact) {
    return (
      <div className="rounded-xl border border-danger/30 px-3.5 py-3 mb-4 flex items-start gap-2" style={{ background: 'rgba(248,113,113,0.08)' }}>
        <ShieldAlert size={15} className="text-danger flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed text-ink-secondary">
          <span className="font-semibold text-ink-primary">If anyone is in immediate danger, call {emergency.label}</span> now
          — the steps below are insurance and financial admin, not first response.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-danger/30 px-4 py-3 flex items-start gap-2.5" style={{ background: 'rgba(248,113,113,0.1)' }}>
      <ShieldAlert size={18} className="text-danger flex-shrink-0 mt-0.5" />
      <p className="text-sm leading-relaxed text-ink-primary">
        <span className="font-semibold">If anyone is in immediate danger, call {emergency.label} now.</span> Keel can
        help with the insurance and financial steps after.
      </p>
    </div>
  )
}
