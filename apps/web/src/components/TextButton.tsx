'use client'

import type { ReactNode } from 'react'

/** A text-only action with a 48px target and text of at least 16px. */
export function TextButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-[48px] px-1 text-base font-semibold text-family-400 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
