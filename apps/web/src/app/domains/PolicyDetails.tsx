'use client'

import { useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import {
  checkPolicyPremium,
  fetchFinancialProfile,
  type FinancialProfilePolicy,
  type PolicyCheck,
} from '@/lib/api'

const TYPE_LABEL: Record<string, string> = {
  life: 'Life cover',
  income_protection: 'Income protection',
  critical_illness: 'Critical illness cover',
}

const gbp = (minor: number) =>
  `£${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/** Digits and a leading plus only, so a number written "0800 000 0000" dials. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/**
 * What was typed for each policy, in one place: cover, premiums, whether the two premiums agree,
 * and who to call. The coverage table says who is covered by what; this says what the policy is.
 * Facts and arithmetic only. It never says whether the cover is enough.
 */
export function PolicyDetails({ types }: { types: string[] }) {
  const [policies, setPolicies] = useState<FinancialProfilePolicy[] | null>(null)
  const [checks, setChecks] = useState<Record<string, PolicyCheck | null>>({})

  useEffect(() => {
    let cancelled = false
    void fetchFinancialProfile().then(async (p) => {
      const mine = (p?.policies ?? []).filter((x) => types.includes(x.type))
      if (cancelled) return
      setPolicies(mine)
      const entries = await Promise.all(
        mine.map(async (x, i): Promise<[string, PolicyCheck | null]> => [
          x.id ?? `i${i}`,
          x.monthly_premium_minor > 0 && (x.annual_premium_minor ?? 0) > 0
            ? await checkPolicyPremium(x.monthly_premium_minor, x.annual_premium_minor)
            : null,
        ]),
      )
      if (!cancelled) setChecks(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
    // `types` is a stable list from the pack; the policies load once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!policies || policies.length === 0) return null

  return (
    <GlassCard className="mt-6 p-4">
      <div data-testid="policy-details">
        <h2 className="text-base font-semibold text-ink-primary">Policies on the list</h2>
        <ul className="mt-3 divide-y divide-haze">
          {policies.map((p, i) => {
            const key = p.id ?? `i${i}`
            const check = checks[key]
            const figures = [
              p.coverage_amount_minor > 0 ? `Cover ${gbp(p.coverage_amount_minor)}` : null,
              p.monthly_premium_minor > 0 ? `${gbp(p.monthly_premium_minor)} a month` : null,
              (p.annual_premium_minor ?? 0) > 0 ? `${gbp(p.annual_premium_minor!)} a year` : null,
            ].filter(Boolean)
            return (
              <li key={key} className="py-3 first:pt-0 last:pb-0">
                <div className="text-base font-medium text-ink-primary">
                  {p.provider || 'Provider not entered'} · {TYPE_LABEL[p.type] ?? p.type}
                </div>
                {figures.length > 0 && (
                  <p className="mt-0.5 text-sm text-ink-secondary">{figures.join(' · ')}</p>
                )}
                {check?.status === 'mismatch' && (
                  <p className="mt-1 text-sm text-ink-secondary">{check.text}</p>
                )}
                {(p.contact_phone || p.contact_email) && (
                  <p className="mt-1 text-sm text-ink-secondary">
                    Claims:{' '}
                    {p.contact_phone && (
                      <a href={telHref(p.contact_phone)} className="underline">
                        {p.contact_phone}
                      </a>
                    )}
                    {p.contact_phone && p.contact_email && ' · '}
                    {p.contact_email && (
                      <a href={`mailto:${p.contact_email}`} className="underline">
                        {p.contact_email}
                      </a>
                    )}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </GlassCard>
  )
}
