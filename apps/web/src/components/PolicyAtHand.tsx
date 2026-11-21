'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, Mail } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchFinancialProfile, type FinancialProfile, type LifeEventType } from '@/lib/api'
import { emergencyPolicies, POLICY_TYPE_LABEL } from '@/lib/emergency-policies'

const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

/**
 * The first thing on a steps page: the policies on file that bear on what happened,
 * with a call button. It states what is on file and never whether it is enough.
 */
export function PolicyAtHand({ eventType }: { eventType: LifeEventType }) {
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

  if (profile === undefined) return null
  const { applies, matches } = emergencyPolicies(eventType, profile?.policies)
  if (!applies) return null

  return (
    <section aria-labelledby="at-hand-heading" data-testid="policy-at-hand">
      <h2 id="at-hand-heading" className="mb-2 px-1 text-lg font-semibold text-ink-primary">
        Your cover on file
      </h2>
      {matches.length === 0 ? (
        <GlassCard className="p-4">
          <p className="text-sm text-ink-secondary">
            No matching policy is on your list yet. If you have one to hand, you can add it now.
          </p>
          <Link
            href="/policies/new"
            className="mt-3 inline-flex min-h-[48px] items-center rounded-full bg-family-500 px-5 text-sm font-semibold text-[rgb(var(--on-cta))]"
          >
            Add a policy
          </Link>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {matches.map((p, i) => (
            <GlassCard key={p.id ?? i} className="p-4">
              <div className="text-xs font-semibold text-family-400">
                {POLICY_TYPE_LABEL[p.type] ?? p.type}
              </div>
              <div className="mt-1 text-lg font-bold text-ink-primary">{p.provider}</div>
              {p.coverage_amount_minor > 0 && (
                <div className="text-sm text-ink-secondary">
                  Cover on file: {gbp(p.coverage_amount_minor)}
                </div>
              )}
              {p.policy_number && (
                <div className="text-sm text-ink-secondary">Policy number: {p.policy_number}</div>
              )}
              <div className="mt-3 flex flex-col gap-2">
                {p.contact_phone ? (
                  <a
                    href={`tel:${p.contact_phone.replace(/[^\d+]/g, '')}`}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-family-500 px-5 text-sm font-semibold text-[rgb(var(--on-cta))]"
                  >
                    <Phone size={16} aria-hidden="true" />
                    Call {p.contact_phone}
                  </a>
                ) : (
                  <p className="text-sm text-ink-tertiary">
                    No phone number on file for this policy.
                  </p>
                )}
                {p.contact_email && (
                  <a
                    href={`mailto:${p.contact_email}`}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-ink-secondary border border-tint/15"
                  >
                    <Mail size={16} aria-hidden="true" />
                    Email {p.contact_email}
                  </a>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </section>
  )
}
