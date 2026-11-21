'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HomeExperience } from './landing/HomeExperience'
import { SiteHeader } from './landing/SiteHeader'
import { SiteFooter } from './landing/SiteFooter'
import { currentUtm, track } from '@/lib/growth-track'

/** The home page used to hold every section; old links to its anchors now go to the page that has them. */
export const MOVED_ANCHORS: Record<string, string> = {
  '#how-it-works': '/how-it-works',
  '#problems': '/how-it-works',
  '#features': '/features',
  '#pricing': '/pricing',
  '#security': '/about',
  '#faq': '/faq',
}

export function MarketingLanding() {
  const router = useRouter()

  useEffect(() => {
    const moved = MOVED_ANCHORS[window.location.hash]
    if (moved) {
      router.replace(moved)
      return
    }
    if (document.documentElement.dataset.session === '1') return
    track('landing_view', currentUtm())
  }, [router])

  return (
    <div className="lk-vivid">
      <SiteHeader />
      <HomeExperience />
      <div className="landing">
        <SiteFooter />
      </div>
    </div>
  )
}
