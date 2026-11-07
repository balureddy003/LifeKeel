'use client'

import Link from 'next/link'
import { BookOpenCheck, ChevronRight, LifeBuoy, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { haptic } from '@/lib/haptics'

export interface Door {
  href: string
  title: string
  description: string
  icon: LucideIcon
}

/**
 * Three equal ways in. Money is one of them, not the front door: recording what
 * the other adult should know and the first steps if something happens stand
 * beside it. Every line states what the door gives you, never what to do with
 * your money.
 */
export const DOORS: Door[] = [
  {
    href: '/briefs',
    title: 'Answer a money question',
    description: 'One question, one number, shared with the other adult.',
    icon: BookOpenCheck,
  },
  {
    href: '/briefs?start=handover_gap',
    title: 'Record what the other adult should know',
    description: 'Contacts, key papers and where things are kept.',
    icon: Users,
  },
  {
    href: '/life-events',
    title: 'See first steps if something happens',
    description: 'A short list for the first hours, using what is on file.',
    icon: LifeBuoy,
  },
]

export function ThreeDoors() {
  return (
    <section aria-labelledby="doors-heading">
      <h2 id="doors-heading" className="sr-only">
        Where to start
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        {DOORS.map((d) => (
          <Link key={d.href} href={d.href} onClick={() => haptic('light')} className="block">
            <GlassCard className="h-full p-4" interactive>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-family-500/20 bg-family-500/10">
                  <d.icon size={18} className="text-family-400" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-primary">{d.title}</div>
                  <div className="mt-0.5 text-xs text-ink-tertiary">{d.description}</div>
                </div>
                <ChevronRight size={16} className="mt-1 text-ink-tertiary" aria-hidden="true" />
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-tertiary">
        <Link href="/domains?d=life_protection" className="underline">
          See who is covered by which policy
        </Link>
      </p>
    </section>
  )
}
