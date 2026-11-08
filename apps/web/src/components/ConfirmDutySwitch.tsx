'use client'

import { useId } from 'react'

/**
 * The organizer's switch for one adult: do they have to confirm the family
 * list? On by default. Turn it off for someone who cannot or does not need to,
 * for example a person the organizer cares for, so the list does not wait for
 * them. It states what it does and nothing more.
 */
export function ConfirmDutySwitch({
  name,
  required,
  busy = false,
  onChange,
}: {
  name: string
  required: boolean
  busy?: boolean
  onChange: (next: boolean) => void
}) {
  const hintId = useId()
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={required}
        aria-describedby={hintId}
        aria-label={`${name} confirms the family list`}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onChange(!required)
        }}
        className="mt-2 inline-flex min-h-[48px] items-center gap-3 rounded-full border border-haze px-4 text-base text-ink-primary disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${required ? 'bg-family-500' : 'bg-haze'}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${required ? 'left-[22px]' : 'left-0.5'}`}
          />
        </span>
        <span>{required ? 'Asked to confirm' : 'Does not need to confirm'}</span>
      </button>
      <p id={hintId} className="mt-1 text-sm text-ink-secondary">
        {required
          ? `Turn this off if ${name} does not need to confirm the family list, for example someone you care for.`
          : `Turn this on to ask ${name} to confirm the family list.`}
      </p>
    </>
  )
}
