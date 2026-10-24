'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import {
  TRACKERS_CONFIGURED,
  isTrackablePath,
  onConsentChange,
  readConsent,
  writeConsent,
  type ConsentChoice,
} from '@/lib/consent'
import { GoogleAnalytics } from '@/components/GoogleAnalytics'
import { AdPixels } from '@/components/AdPixels'

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

/**
 * Loads advertising/analytics tags only with consent, on public pages, for
 * signed-out visitors (R36). Once loaded, moving to a page that isn't
 * trackable switches GA off for the rest of the visit, so single-page
 * navigation into the app doesn't report signed-in URLs.
 */
export function MarketingTags() {
  const pathname = usePathname()
  const { isAuthenticated } = useAuth()
  const [choice, setChoice] = useState<ConsentChoice | null | 'unknown'>('unknown')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setChoice(readConsent())
    return onConsentChange(() => setChoice(readConsent()))
  }, [])

  const trackable = isTrackablePath(pathname, isAuthenticated)
  useEffect(() => {
    if (choice === 'accepted' && trackable) setLoaded(true)
    if (GA_ID) {
      ;(window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = !trackable
    }
  }, [choice, trackable])

  if (!TRACKERS_CONFIGURED) return null
  return (
    <>
      {loaded && (
        <>
          <GoogleAnalytics />
          <AdPixels />
        </>
      )}
      {choice === null && (trackable || pathname === '/privacy' || pathname === '/cookies') && (
        <ConsentBanner />
      )}
    </>
  )
}

function ConsentBanner() {
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie choices"
      className="landing lk-consent-banner fixed inset-x-0 bottom-0 z-[60] p-4"
    >
      <div className="glass mx-auto max-w-2xl rounded-2xl p-4 text-sm text-ink-primary shadow-lg">
        <p className="mb-3 leading-relaxed">
          We&apos;d like to use advertising and analytics cookies from Google, Meta and LinkedIn to
          measure our marketing. They are off unless you accept, and they never run inside your
          LifeKeel account.{' '}
          <a href="/cookies" className="underline">
            Cookies & storage
          </a>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => writeConsent('rejected')}
            className="flex-1 rounded-xl border border-current px-4 py-2.5 font-semibold"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => writeConsent('accepted')}
            className="flex-1 rounded-xl border border-current px-4 py-2.5 font-semibold"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
