'use client'

/**
 * The push-notification switch. The visible track is small; the button around
 * it is the target a thumb has to hit, so it is at least 48 by 48.
 */
export function PushToggle({
  enabled,
  disabled = false,
  onToggle,
}: {
  enabled: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Push notifications"
      disabled={disabled}
      onClick={onToggle}
      className="flex min-h-[48px] min-w-[48px] flex-shrink-0 items-center justify-center disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className={`relative block h-7 w-12 rounded-full transition-colors ${
          enabled ? 'bg-family-500' : 'bg-tint/10'
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}
