'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchFinancialProfile, type FinancialProfile } from '@/lib/api'
import { pinnedTiles } from '@/lib/pinned-tiles'
import { haptic } from '@/lib/haptics'

/** Pinned tiles: one figure each from the household's own file, or "No data yet". */
export function PinnedTiles() {
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

  if (profile === undefined) return null // no flash of empty tiles while loading

  return (
    <section aria-labelledby="pinned-heading" className="space-y-2">
      <h2 id="pinned-heading" className="px-1 text-lg font-semibold text-ink-primary">
        Pinned
      </h2>
      <div className="space-y-2" data-testid="pinned-tiles">
        {pinnedTiles(profile).map((t) => (
          <Link key={t.id} href={t.href} onClick={() => haptic('light')} className="block">
            <GlassCard className="p-4" interactive>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-family-400">{t.title}</div>
                  {t.value === null ? (
                    <>
                      <div className="mt-2 text-2xl font-bold text-ink-tertiary">No data yet</div>
                      <div className="mt-0.5 text-xs text-ink-tertiary">{t.emptyHint}</div>
                    </>
                  ) : (
                    <>
                      <div className="mt-2 text-2xl font-bold text-ink-primary">{t.value}</div>
                      <div className="mt-0.5 text-xs text-ink-tertiary">{t.detail}</div>
                    </>
                  )}
                </div>
                <ChevronRight
                  size={16}
                  className="flex-shrink-0 text-ink-tertiary"
                  aria-hidden="true"
                />
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
    </section>
  )
}
