'use client'

import { useEffect } from 'react'
import { HomeExperience } from './landing/HomeExperience'
import { SiteHeader } from './landing/SiteHeader'
import { SiteFooter } from './landing/SiteFooter'
import { currentUtm, track } from '@/lib/growth-track'

export function MarketingLanding() {
  useEffect(() => {
    if (document.documentElement.dataset.session === '1') return
    track('landing_view', currentUtm())
  }, [])

  return (
    <div className="lk-home-experience lk-studio">
      <SiteHeader />
      <HomeExperience />
      <div className="landing">
        <SiteFooter />
      </div>
    </div>
  )
}
