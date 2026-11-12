'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'
import { reportConcern, type ConcernCategory } from '@/lib/keel/client'
import { useKeelPanel } from '@/lib/keel/store'
import type { KeelRoute } from '@/lib/keel/types'

const CATEGORIES: Array<{ id: ConcernCategory; label: string }> = [
  { id: 'incorrect', label: 'Wrong or misleading' },
  { id: 'advice', label: 'Sounded like financial advice' },
  { id: 'harmful', label: 'Unsafe or upsetting' },
  { id: 'privacy', label: "Showed something it shouldn't" },
  { id: 'other', label: 'Something else' },
]

/** G-AI-03: lets a family member flag a Keel reply for human review. */
export function KeelConcern({ route }: { route: KeelRoute }) {
  const threadId = useKeelPanel((s) => s.threadId)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<ConcernCategory | null>(null)
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  if (state === 'sent') {
    return (
      <p className="mt-2 text-xs text-ink-tertiary" role="status">
        Thanks. A person at LifeKeel will review this reply.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex min-h-[32px] items-center gap-1 text-xs text-ink-tertiary hover:text-ink-secondary"
      >
        <Flag size={12} aria-hidden /> Report a concern
      </button>
    )
  }

  const submit = async () => {
    if (!category) return
    setState('sending')
    const ok = await reportConcern({ category, route, threadId, note })
    setState(ok ? 'sent' : 'failed')
  }

  return (
    <fieldset className="mt-2 rounded-xl border border-ink-tertiary/15 p-3">
      <legend className="px-1 text-xs font-semibold text-ink-secondary">
        What was wrong with this reply?
      </legend>
      <div className="flex flex-col gap-1">
        {CATEGORIES.map((c) => (
          <label key={c.id} className="flex min-h-[32px] items-center gap-2 text-xs">
            <input
              type="radio"
              name="keel-concern"
              value={c.id}
              checked={category === c.id}
              onChange={() => setCategory(c.id)}
            />
            {c.label}
          </label>
        ))}
      </div>
      <label className="mt-2 block text-xs text-ink-tertiary">
        Anything else we should know? (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          className="mt-1 w-full rounded-lg bg-transparent p-2 text-xs text-ink-primary ring-1 ring-ink-tertiary/20"
        />
      </label>
      {state === 'failed' && (
        <p className="mt-1 text-xs text-warning" role="alert">
          That didn&apos;t send. Try again in a moment.
        </p>
      )}
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          disabled={!category || state === 'sending'}
          onClick={() => void submit()}
          className="min-h-[36px] rounded-full bg-family-500 px-4 text-xs font-semibold text-[rgb(var(--on-cta))] disabled:opacity-50"
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[36px] text-xs text-ink-tertiary"
        >
          Cancel
        </button>
      </div>
    </fieldset>
  )
}
