'use client'

import { useEffect, useState } from 'react'
import { REGIONS, REGION_LABELS, redirectTarget, regionForHost, type Region } from '@/lib/region'
import { isNativeShell, saveRegion } from '@/lib/native'

/**
 * "Region: United Kingdom · Change" — shown only in the native shell, on
 * login, signup and settings. An account lives on one region's app host, so a
 * wrong locale guess (or a user who moved) needs a one-tap way to the other.
 */
export function RegionSwitch({ className = '' }: { className?: string }) {
  const [current, setCurrent] = useState<Region | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isNativeShell()) setCurrent(regionForHost(window.location.host))
  }, [])

  if (!current) return null

  const choose = async (region: Region) => {
    await saveRegion(region)
    const target = redirectTarget(region, window.location)
    if (target) window.location.replace(target)
    else setOpen(false)
  }

  return (
    <div className={`text-center text-xs text-ink-tertiary ${className}`}>
      Region: {REGION_LABELS[current]} ·{' '}
      <button
        type="button"
        className="underline underline-offset-2 text-ink-secondary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Change
      </button>
      {open && (
        <div
          role="group"
          aria-label="Choose your region"
          className="mt-2 flex justify-center gap-2"
        >
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === current}
              onClick={() => void choose(r)}
              className="min-h-[44px] rounded-xl px-4 text-sm font-semibold bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary aria-pressed:text-family-400"
            >
              {REGION_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
