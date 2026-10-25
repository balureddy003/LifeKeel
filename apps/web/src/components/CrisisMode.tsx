'use client'

/**
 * Intent 33: crisis mode — the whole dashboard reduced to what a family in
 * crisis actually needs: the top three pending playbook steps for the
 * reported event, the emergency-fund figure, and a direct path back to the
 * event's full checklist and the vault. Deliberate and reversible — set
 * from the event page, cleared by "Back to full dashboard".
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, FileText, ChevronRight, X } from 'lucide-react'
import { GlassCard } from './Glass'
import { LIFE_EVENTS } from '@/lib/life-data'
import { EVENT_ACTIONS, loadDoneIds } from '@/app/events/[eventId]/EventDetailClient'
import { fetchFamilyReadiness } from '@/lib/api'

export const CRISIS_EVENT_KEY = 'lk_crisis_event'

export default function CrisisMode({ eventId, onExit }: { eventId: string; onExit: () => void }) {
  const event = LIFE_EVENTS.find((e) => e.id === eventId)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [fundDetail, setFundDetail] = useState<string | null>(null)

  useEffect(() => {
    setDone(loadDoneIds(eventId))
    fetchFamilyReadiness().then((r) => {
      const c = r?.components?.find((c) => c.key === 'emergency_fund')
      setFundDetail(c?.detail ?? (c?.score != null ? `Score ${c.score}` : null))
    })
  }, [eventId])

  const pending = (EVENT_ACTIONS[eventId] ?? EVENT_ACTIONS.default!)
    .filter((a) => !done.has(a.id))
    .slice(0, 3)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-family-500 uppercase tracking-wide">
            Crisis mode
          </p>
          <h1 className="text-xl font-bold text-ink-primary">
            {event?.label ?? 'Your plan for right now'}
          </h1>
          <p className="text-sm text-ink-tertiary mt-1">
            Just the three next things — nothing else to manage right now.
          </p>
        </div>
        <button
          onClick={onExit}
          aria-label="Exit crisis mode and return to the full dashboard"
          className="flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink-primary border border-glass-border rounded-full px-3 py-1.5 min-h-[36px]"
        >
          <X size={14} /> Full dashboard
        </button>
      </div>

      <GlassCard className="p-5">
        <div className="text-sm font-semibold text-ink-primary mb-3">Next three steps</div>
        {pending.length === 0 ? (
          <p className="text-sm text-ink-secondary">Every step is done. Well handled.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <Circle size={18} className="text-ink-tertiary mt-0.5 shrink-0" />
                <div className="text-sm font-medium text-ink-primary">{a.label}</div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/events/${eventId}`}
          className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-family-500 min-h-[36px]"
        >
          <CheckCircle2 size={14} /> Open the full checklist
        </Link>
      </GlassCard>

      {fundDetail && (
        <GlassCard className="p-5">
          <div className="text-sm font-semibold text-ink-primary mb-1">Emergency fund</div>
          <p className="text-sm text-ink-secondary">{fundDetail}</p>
        </GlassCard>
      )}

      <Link href="/documents" aria-label="Open documents and contacts">
        <GlassCard className="p-5 flex items-center gap-3">
          <FileText size={18} className="text-ink-tertiary" />
          <span className="text-sm font-medium text-ink-primary flex-1">
            Documents &amp; contacts
          </span>
          <ChevronRight size={16} className="text-ink-tertiary" />
        </GlassCard>
      </Link>
    </div>
  )
}
