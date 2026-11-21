'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, Mail } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import {
  fetchFinancialProfile,
  getDomainView,
  type DomainView,
  type FinancialProfile,
  type LifeEventType,
} from '@/lib/api'
import { SERVICES, atHandFor } from '@/lib/services'

/**
 * The first thing on a steps page: what is on file that bears on what happened,
 * with a call button. Every service that declares an emergency section appears
 * here, so a new service needs no edit in this file. It states what is on file
 * and never whether it is enough.
 */
export function AtHand({ eventType }: { eventType: LifeEventType }) {
  const [profile, setProfile] = useState<FinancialProfile | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setProfile(null))
    return () => {
      cancelled = true
    }
  }, [])

  // Load only the family-list packs the services say this event reads.
  const [domains, setDomains] = useState<Record<string, DomainView | null>>({})
  useEffect(() => {
    let cancelled = false
    for (const s of SERVICES) {
      const d = s.emergencyDomain
      if (!d || d.eventType !== eventType) continue
      getDomainView(d.domainId)
        .then((v) => !cancelled && setDomains((m) => ({ ...m, [d.domainId]: v })))
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [eventType])

  if (profile === undefined) return null
  const sections = atHandFor(SERVICES, eventType, { profile, documentCount: 0, domains })
  if (sections.length === 0) return null

  return (
    <div className="space-y-6" data-testid="at-hand">
      {sections.map((section) => (
        <section key={section.heading} aria-label={section.heading}>
          <h2 className="mb-2 px-1 text-lg font-semibold text-ink-primary">{section.heading}</h2>
          {section.items.length === 0 ? (
            <GlassCard className="p-4">
              <p className="text-sm text-ink-secondary">{section.empty.text}</p>
              <Link
                href={section.empty.href}
                className="mt-3 inline-flex min-h-[48px] items-center rounded-full bg-family-500 px-5 text-sm font-semibold text-[rgb(var(--on-cta))]"
              >
                {section.empty.label}
              </Link>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {section.items.map((item) => (
                <GlassCard key={item.key} className="p-4">
                  <div className="text-xs font-semibold text-family-400">{item.kicker}</div>
                  <div className="mt-1 text-lg font-bold text-ink-primary">{item.title}</div>
                  {item.facts.map((f) => (
                    <div key={f} className="text-sm text-ink-secondary">
                      {f}
                    </div>
                  ))}
                  <div className="mt-3 flex flex-col gap-2">
                    {item.phone ? (
                      <a
                        href={`tel:${item.phone.replace(/[^\d+]/g, '')}`}
                        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-family-500 px-5 text-sm font-semibold text-[rgb(var(--on-cta))]"
                      >
                        <Phone size={16} aria-hidden="true" />
                        Call {item.phone}
                      </a>
                    ) : (
                      <p className="text-sm text-ink-tertiary">No phone number on file.</p>
                    )}
                    {item.email && (
                      <a
                        href={`mailto:${item.email}`}
                        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-ink-secondary border border-tint/15"
                      >
                        <Mail size={16} aria-hidden="true" />
                        Email {item.email}
                      </a>
                    )}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
