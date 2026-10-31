'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

const KEY = 'lk_home_more_open'

/**
 * Everything on home that is not today's one thing or the findings: family,
 * health, timeline, memory prompts. Folded away once the account has data, so
 * the page has one next move; the choice to open it is remembered on this
 * device. A new account has little to fold, so it stays open there.
 */
export function MoreOnHome({ fold, children }: { fold: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) === '1')
    } catch {
      // Storage can be blocked; the fold then just starts closed each visit.
    }
  }, [])

  if (!fold) return <>{children}</>

  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = (e.target as HTMLDetailsElement).open
        setOpen(next)
        try {
          localStorage.setItem(KEY, next ? '1' : '0')
        } catch {
          // Not worth failing a toggle over.
        }
      }}
      className="group"
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-2xl border border-haze bg-surface-1 px-4 text-sm font-semibold text-ink-secondary">
        More about your family
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  )
}
