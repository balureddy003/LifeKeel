'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

const KEY = 'lk_home_more_open'

/**
 * Everything on home that is not today's one thing or the findings: family,
 * health, timeline, memory prompts. Folded away for every account, so the page
 * has one next move; the choice to open it is remembered on this device. A new
 * account's version of these cards is mostly empty states, which stacked into a
 * page about 3,200px tall, so it folds too, with a hint of what is inside.
 */
export function MoreOnHome({
  fold,
  hint,
  children,
}: {
  fold: boolean
  /** One line saying what is inside, so a closed fold is not a mystery. */
  hint?: string
  children: ReactNode
}) {
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
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-haze bg-surface-1 px-4 py-2 text-sm font-semibold text-ink-secondary">
        <span className="min-w-0">
          More about your family
          {hint && (
            <span className="mt-0.5 block text-xs font-normal text-ink-tertiary">{hint}</span>
          )}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="flex-shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  )
}
