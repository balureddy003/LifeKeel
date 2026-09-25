'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Briefcase, HeartCrack, Activity, HeartPulse, Car, Home, Plane, ChevronRight, Loader2, AlertCircle, ShieldAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, GlassButton, PageHeader } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useAuth } from '@/lib/auth-context'
import { reportLifeEvent, fetchLifeEvents, type LifeEvent, type LifeEventType } from '@/lib/api'

const EVENT_TYPES: { id: LifeEventType; label: string; description: string; icon: LucideIcon }[] = [
  { id: 'job_loss', label: 'Job loss', description: 'See your real runway and what to do first', icon: Briefcase },
  { id: 'bereavement', label: 'Bereavement', description: "Notify your family's real insurers and providers", icon: HeartCrack },
  { id: 'disability', label: 'Disability / critical illness', description: 'See whether your real cover applies', icon: Activity },
  { id: 'medical', label: 'Medical emergency', description: 'Check your real health cover and what to notify', icon: HeartPulse },
  { id: 'car', label: 'Car accident', description: 'Your real car policy and claim deadlines', icon: Car },
  { id: 'property', label: 'Property damage', description: 'Your real home cover and what to document', icon: Home },
  { id: 'travel', label: 'Travel emergency', description: 'Cover checks, receipts, embassy steps', icon: Plane },
]

// This page is reachable directly (Home's "Report a life event" card), not
// only via Emergency Mode's own safety banner — a family arriving here for
// one of these four types may still be in physical danger, and everything
// below this point is insurance/financial admin, not first response.
const URGENT_TYPES = new Set<LifeEventType>(['medical', 'car', 'property', 'travel'])

function LifeSafetyNotice() {
  return (
    <div className="rounded-xl border border-danger/30 px-3.5 py-3 mb-4 flex items-start gap-2" style={{ background: 'rgba(248,113,113,0.08)' }}>
      <ShieldAlert size={15} className="text-danger flex-shrink-0 mt-0.5" />
      <p className="text-xs leading-relaxed text-ink-secondary">
        <span className="font-semibold text-ink-primary">If anyone is in immediate danger, call 911</span> (or your
        local emergency number) now — the steps below are insurance and financial admin, not first response.
      </p>
    </div>
  )
}

export default function LifeEventsPage() {
  const router = useRouter()
  const { family } = useAuth()
  const [selectedType, setSelectedType] = useState<LifeEventType | null>(null)
  const [affectedMemberId, setAffectedMemberId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Most recent already-reported event of the picked type, if any — the
  // de-dupe check. A double-tap in a crisis shouldn't silently create a
  // second record of the same event.
  const [existingSameType, setExistingSameType] = useState<LifeEvent | null>(null)

  const otherMembers = (family?.members ?? []).filter((m) => m.role !== 'child')

  // ?type= carried through from Emergency Mode — the picked crisis type
  // survives into the real flow (straight to confirm) instead of forcing
  // a re-pick from a differently-labeled list. Read via window.location,
  // same static-export convention as financial-profile's ?step=.
  useEffect(() => {
    const type = new URLSearchParams(window.location.search).get('type')
    if (type && EVENT_TYPES.some((e) => e.id === type)) {
      setSelectedType(type as LifeEventType)
    }
  }, [])

  useEffect(() => {
    if (!selectedType) { setExistingSameType(null); return }
    let cancelled = false
    fetchLifeEvents().then((events) => {
      if (cancelled) return
      // API returns most recent first — first match is the latest report.
      setExistingSameType(events.find((e) => e.event_type === selectedType) ?? null)
    })
    return () => { cancelled = true }
  }, [selectedType])

  const handleSubmit = async () => {
    if (!selectedType) return
    haptic('light')
    setSubmitting(true)
    setError(null)
    const event = await reportLifeEvent(selectedType, affectedMemberId || undefined)
    setSubmitting(false)
    if (!event) {
      setError("That didn't go through — nothing was recorded. You can try again whenever you're ready.")
      return
    }
    router.push(`/life-events/${event.id}`)
  }

  return (
    <div className="px-5 pt-2 space-y-5">
      <PageHeader
        title="Report a life event"
        subtitle="Tell Oak what's actually happening and get a plan based on your real data"
      />

      {!selectedType ? (
        <div className="space-y-3">
          {EVENT_TYPES.map((event, i) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <GlassCard
                className="p-4"
                interactive
                onClick={() => {
                  haptic('light')
                  setSelectedType(event.id)
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center flex-shrink-0">
                    <event.icon size={22} className="text-danger" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Same finding and fix as events/page.tsx's "What If?"
                        list: titles ("Disability / critical illness",
                        "Medical emergency") were truncating to
                        "Disability / cri..." despite vertical room to
                        wrap. Only the less-critical description stays
                        single-line truncated. */}
                    <div className="text-base font-semibold leading-snug line-clamp-2">{event.label}</div>
                    <div className="text-xs text-ink-tertiary truncate">{event.description}</div>
                  </div>
                  <ChevronRight size={18} className="text-ink-tertiary" />
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <GlassCard className="p-5">
            <div className="text-sm font-semibold text-ink-secondary mb-3">
              {EVENT_TYPES.find((e) => e.id === selectedType)?.label}
            </div>

            {URGENT_TYPES.has(selectedType) && <LifeSafetyNotice />}


            {existingSameType && (
              <div className="rounded-xl bg-warning/10 border border-warning/20 px-3.5 py-3 mb-4 flex items-start gap-2">
                <AlertCircle size={15} className="text-warning flex-shrink-0 mt-0.5" />
                <p className="text-xs text-ink-secondary leading-relaxed">
                  An event of this type was already reported on{' '}
                  {new Date(existingSameType.reported_at).toLocaleDateString()}.{' '}
                  <Link href={`/life-events/${existingSameType.id}`} className="text-family-400 font-semibold">
                    Open it
                  </Link>{' '}
                  — or report a new one below if this is a separate incident.
                </p>
              </div>
            )}

            {otherMembers.length > 0 && (
              <div className="mb-4">
                <label className="text-xs text-ink-tertiary mb-2 block">Who does this affect? (optional)</label>
                <select
                  value={affectedMemberId}
                  onChange={(e) => setAffectedMemberId(e.target.value)}
                  className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary outline-none"
                >
                  <option value="">The household overall</option>
                  {otherMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            )}

            <GlassButton onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 size={18} className="animate-spin" /> : null}
              <span>{submitting ? 'Building your plan…' : existingSameType ? 'Report anyway' : 'Get my plan'}</span>
            </GlassButton>
            {error && <p role="status" aria-live="polite" className="text-sm text-danger mt-3">{error}</p>}

            <button
              onClick={() => { setSelectedType(null); setAffectedMemberId('') }}
              className="text-xs text-ink-tertiary font-semibold mt-3"
            >
              Choose a different event
            </button>
          </GlassCard>
        </motion.div>
      )}

      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-ink-tertiary leading-relaxed">
          This is for something that has actually happened, personalized against your family's real data. Just
          exploring a hypothetical? Try &quot;What If?&quot; from the Events tab instead.
        </p>
      </div>
    </div>
  )
}
