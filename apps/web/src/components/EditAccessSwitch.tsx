'use client'

/**
 * The organizer's switch for one adult: may they add and change what is on the
 * family list? Off by default. It states what it does and nothing more.
 */
export function EditAccessSwitch({
  name,
  enabled,
  busy = false,
  onChange,
}: {
  name: string
  enabled: boolean
  busy?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${name} can add and change the family list`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!enabled)
      }}
      className="mt-2 inline-flex min-h-[48px] items-center gap-3 rounded-full border border-haze px-4 text-base text-ink-primary disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-family-500' : 'bg-haze'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
      <span>{enabled ? 'Can edit the family list' : 'Can only view'}</span>
    </button>
  )
}
