'use client'

/**
 * PRD-141 — one optional question per quarter. Renders nothing unless the API
 * says it is due (adults only, once per quarter, skip remembered). The
 * question names no product and recommends nothing.
 */
import { useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { answerPerceivedProtection, fetchPerceivedProtectionDue } from '@/lib/api'

/** Names no product and recommends nothing; the advice-rule test scans this file. */
export const PERCEIVED_PROTECTION_QUESTION =
  'How confident are you that your family’s key items are covered?'

const SCALE = [
  { score: 1, label: 'Not at all' },
  { score: 2, label: 'Slightly' },
  { score: 3, label: 'Somewhat' },
  { score: 4, label: 'Fairly' },
  { score: 5, label: 'Very' },
] as const

export function PerceivedProtectionCard() {
  const [due, setDue] = useState(false)
  const [thanked, setThanked] = useState(false)

  useEffect(() => {
    let live = true
    fetchPerceivedProtectionDue().then((r) => {
      if (live && r?.due) setDue(true)
    })
    return () => {
      live = false
    }
  }, [])

  async function answer(score: number | null) {
    haptic('light')
    // Hide at once: a failed save only means we ask again next visit.
    setDue(false)
    if (score !== null) setThanked(true)
    await answerPerceivedProtection(score)
  }

  if (thanked) {
    return (
      <p role="status" className="text-xs text-ink-tertiary mt-3 px-1">
        Thanks. We ask this once a quarter.
      </p>
    )
  }
  if (!due) return null

  return (
    <GlassCard className="p-4 mt-4">
      <p className="text-sm font-semibold text-ink-primary" id="pp-question">
        {PERCEIVED_PROTECTION_QUESTION}
      </p>
      <div role="group" aria-labelledby="pp-question" className="mt-3 grid grid-cols-5 gap-1.5">
        {SCALE.map((s) => (
          <button
            key={s.score}
            type="button"
            onClick={() => answer(s.score)}
            className="rounded-xl bg-tint/[0.04] border border-tint/[0.08] px-1 py-2 text-xs text-ink-secondary"
          >
            <span className="block text-sm font-semibold text-ink-primary">{s.score}</span>
            {s.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => answer(null)}
        className="mt-3 text-xs text-ink-tertiary underline-offset-2 hover:underline"
      >
        Not now
      </button>
    </GlassCard>
  )
}
