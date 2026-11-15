'use client'

/**
 * /resilience — how long the household's savings would cover spending if the main income stopped.
 * Tier 0, read-only. The server (GET /family/resilience) does all the arithmetic and decides who may see it;
 * this page only shows what it sends: an estimate, what the estimate leaves out, and what to check next.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader, GlassCard } from '@/components/Glass'
import { fetchFamilyResilience, type FamilyResilience } from '@/lib/api'

export default function ResiliencePage() {
  const [data, setData] = useState<FamilyResilience | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetchFamilyResilience()
      .then(setData)
      .finally(() => setLoaded(true))
  }, [])

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="If your income stops"
        backHref="/finances"
        subtitle="An estimate from the figures you entered"
      />

      {!loaded && (
        <div className="flex justify-center py-10 text-ink-tertiary">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
        </div>
      )}

      {loaded && !data && (
        <GlassCard className="p-4 text-sm text-ink-secondary">
          This is for adults in your family. If you are one, it could not load right now, so try
          again in a moment.
        </GlassCard>
      )}

      {loaded && data?.status === 'needs_figures' && (
        <GlassCard className="p-4 space-y-2 text-sm text-ink-secondary">
          <p>To work this out we need: {data.missing.join(', ')}.</p>
          <Link href="/financial-profile" className="text-accent underline">
            Open your financial profile
          </Link>
        </GlassCard>
      )}

      {loaded && data?.status === 'ready' && (
        <>
          <GlassCard className="p-4 space-y-3">
            <p className="text-base text-ink-primary">{data.text}</p>
            <p className="text-sm text-ink-tertiary">
              Left out of this estimate: {data.left_out.join(', ')}.
            </p>
          </GlassCard>
          <GlassCard className="p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
              What to check next
            </h2>
            <ul className="space-y-2 text-sm text-ink-primary list-disc pl-5">
              {data.next_checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </GlassCard>
        </>
      )}
    </div>
  )
}
