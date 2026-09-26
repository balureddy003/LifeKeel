'use client'

/**
 * /marketing moved into the operator shell at /operator/marketing.
 * Static export can't do server-side redirects, so this stub carries the
 * query params across — the X OAuth callback returns here via
 * ?connected=twitter_x / ?error=…, which the real page toasts on.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MarketingRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace(`/operator/marketing${window.location.search}`)
  }, [router])
  return <div className="shimmer h-24 rounded-2xl mx-5 mt-6" />
}
