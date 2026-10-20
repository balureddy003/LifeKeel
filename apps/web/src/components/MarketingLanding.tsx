'use client'

/**
 * The public marketing page shown at "/" to a logged-out visitor, not the compact
 * fallback AuthGate shows for any OTHER route hit while logged out.
 *
 * The story is "The Chart" (docs/prd/209-landing-chart-story.md): hero, sample day,
 * story board, cover on file, crisis steps, six promises, then pricing, FAQ and a
 * dawn close. Those scenes live in ./landing; every claim they make maps to
 * ./landing/claims.ts. This page does NOT claim Keel acts autonomously on the
 * family's behalf. See ARCHITECTURE.md for what is actually shipped.
 */

import { useEffect } from 'react'
import { LandingHero } from './landing/LandingHero'
import { LandingSymbols } from './landing/LandingSymbols'
import { SampleDay } from './landing/SampleDay'
import { StoryBoard } from './landing/StoryBoard'
import { CoverOnFile } from './landing/CoverOnFile'
import { CrisisSteps } from './landing/CrisisSteps'
import { Promises } from './landing/Promises'
import { DawnClose } from './landing/DawnClose'
import { Security } from './landing/Security'
import { PlusSpotlight } from './landing/PlusSpotlight'
import { Pricing } from './landing/Pricing'
import { Faq } from './landing/Faq'
import { SiteFooter } from './landing/SiteFooter'
import { SiteHeader } from './landing/SiteHeader'
import { YearsTimelapse } from './landing/YearsTimelapse'
import { StickyCta } from './landing/StickyCta'
import { track } from '@/lib/growth-track'
import { useAuth } from '@/lib/auth-context'

export function MarketingLanding() {
  const { isLoading } = useAuth()
  useEffect(() => {
    // Count a view only once the session check has finished and this page is still the one shown:
    // a signed-in visitor is switched to the app in that same commit, so this never runs for them.
    if (isLoading) return
    track('landing_view')
  }, [isLoading])

  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/* Hero: the chart story (PRD-209). Signup goes straight to the existing sign-up page. */}
      <LandingSymbols />
      <LandingHero />

      {/* A read-only sample day (PRD-209). Keeps the #how-it-works anchor the nav links to. */}
      <div id="how-it-works" className="landing">
        <SampleDay />
      </div>

      {/* How the same chart grows as life changes. */}
      <div className="landing">
        <YearsTimelapse />
      </div>

      {/* The story board, built from components/landing/capabilities.ts. Keeps the #features anchor. */}
      <div id="features" className="landing">
        <StoryBoard />
      </div>

      {/* Cover on file, crisis steps and the six promises (PRD-209). */}
      <div className="landing">
        <CoverOnFile />
        <CrisisSteps />
        <Promises />
      </div>

      {/* Security, Keel Plus, pricing and FAQ in the landing look (PRD-209). */}
      <div className="landing">
        <Security />
        <PlusSpotlight />
        <Pricing />
        <Faq />
      </div>

      {/* The close: same sea at dawn, one signup link (PRD-209). */}
      <div className="landing">
        <DawnClose />
      </div>
      <div className="landing">
        <StickyCta />
      </div>

      <div className="landing">
        <SiteFooter />
      </div>
    </div>
  )
}
