'use client'

import { useEffect } from 'react'
import { track } from '@/lib/growth-track'

/** Client-side funnel event — guides are statically rendered so the
 *  analytics call lives in a tiny client component. Also doubles as the
 *  first-touch attribution capture point (track() → captureAttribution). */
export function GuideTracker({ slug }: { slug: string }) {
  useEffect(() => {
    track('guide_view', { slug })
  }, [slug])
  return null
}
