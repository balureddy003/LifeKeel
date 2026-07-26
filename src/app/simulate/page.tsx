'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ChevronRight, Lightbulb, HeartCrack, Heart, Briefcase, Car, Plane, Home, Baby, GraduationCap, Palmtree, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LIFE_EVENTS } from '@/lib/data'
import type { LifeEvent } from '@/lib/types'
import { PageHeader } from '@/components/Glass'

const EVENT_ICONS: Record<string, LucideIcon> = {
  bereavement: HeartCrack,
  medical: Heart,
  'job-loss': Briefcase,
  car: Car,
  travel: Plane,
  property: Home,
  'new-child': Baby,
  marriage: Heart,
  university: GraduationCap,
  retirement: Palmtree,
}

function EventCard({ event, onSelect, selected }: { event: LifeEvent; onSelect: (id: string) => void; selected: boolean }) {
  return (
    <button
      onClick={() => onSelect(event.id)}
      className={`w-full flex items-center gap-3 p-4 rounded-2xl border transition-all active:scale-95 ${
        selected
          ? 'bg-family-500/15 border-family-500/50'
          : 'bg-surface-1 border-haze/20'
      }`}
    >
      <div
        className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors ${
          selected ? 'bg-family-500/20' : 'bg-white/[0.03]'
        }`}
      >
        {(() => {
          const EventIcon = EVENT_ICONS[event.id] ?? Target
          return <EventIcon size={22} className={selected ? 'text-family-400' : 'text-ink-secondary'} strokeWidth={1.5} />
        })()}
      </div>
      <span className={`text-left text-base flex-1 ${selected ? 'text-family-400 font-semibold' : 'text-ink-primary'}`}>
        {event.label}
      </span>
      {selected && <Check size={20} className="text-family-400" />}
    </button>
  )
}

export default function SimulatePage() {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)

  return (
    <div className="px-5 pt-2 space-y-5 animate-fade-in">
      <PageHeader
        title="What If?"
        subtitle="Pick a situation to see your family's response plan"
      />

      {/* Event list */}
      <div className="space-y-3">
        {LIFE_EVENTS.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            selected={selectedEvent === event.id}
            onSelect={setSelectedEvent}
          />
        ))}
      </div>

      {/* CTA */}
      {selectedEvent && (
        <Link
          href={`/response-plan/${selectedEvent}`}
          className="btn-primary flex items-center justify-center gap-2 w-full animate-slide-up"
        >
          <span>See Response Plan</span>
          <ChevronRight size={18} />
        </Link>
      )}

      {/* Reassurance */}
      <div className="card bg-surface-2 border-haze/20">
        <div className="flex items-start gap-2">
          <Lightbulb size={18} className="text-ink-secondary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-tertiary leading-relaxed">
            This is a simulation to help you prepare. Your family&apos;s real data stays private and is never shared.
          </p>
        </div>
      </div>
    </div>
  )
}
