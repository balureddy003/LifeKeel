'use client'

import { TRACKERS_CONFIGURED, reopenConsent } from '@/lib/consent'

/** Lets a visitor change or withdraw their cookie choice at any time (R36). */
export function CookieSettingsButton() {
  if (!TRACKERS_CONFIGURED) return null
  return (
    <button
      type="button"
      onClick={reopenConsent}
      className="text-sm font-semibold underline text-ink-primary mb-3"
    >
      Change cookie settings
    </button>
  )
}
