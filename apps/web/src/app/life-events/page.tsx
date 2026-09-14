'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Briefcase, HeartCrack, Activity, ChevronRight, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, GlassButton, PageHeader } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useAuth } from '@/lib/auth-context'
import { reportLifeEvent, type LifeEventType } from '@/lib/api'

const EVENT_TYPES: { id: LifeEventType; label: string; description: string; icon: LucideIcon }[] = [
  { id: 'job_loss', label: 'Job loss', description: 'See your real runway and what to do first', icon: Briefcase },
  { id: 'bereavement', label: 'Bereavement', description: "Notify your family's real insurers and providers", icon: HeartCrack },
  { id: 'disability', label: 'Disability / critical illness', description: 'See whether your real cover applies', icon: Activity },
]

export default function LifeEventsPage() {
  const router = useRouter()
  const { family } = useAuth()
  const [selectedType, setSelectedType] = useState<LifeEventType | null>(null)
  const [affectedMemberId, setAffectedMemberId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const otherMembers = (family?.members ?? []).filter((m) => m.role !== 'child')

  const handleSubmit = async () => {
    if (!selectedType) return
    haptic('light')
    setSubmitting(true)
    setError(null)
    const event = await reportLifeEvent(selectedType, affectedMemberId || undefined)
    setSubmitting(false)
    if (!event) {
      setError("Couldn't report this right now — please try again.")
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
                    <div className="text-base font-semibold truncate">{event.label}</div>
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
              <span>{submitting ? 'Building your plan…' : 'Get my plan'}</span>
            </GlassButton>
            {error && <p className="text-sm text-danger mt-3">{error}</p>}

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
