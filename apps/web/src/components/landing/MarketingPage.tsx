'use client'

import { useEffect, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth-context'
import { currentUtm, track } from '@/lib/growth-track'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { AcrossTheYear } from './AcrossTheYear'
import { FamilyStory } from './FamilyStory'
import { MomentCards } from './MomentCards'
import {
  BadDay,
  Features,
  FinalCta,
  HowItWorks,
  Plans,
  PlusBand,
  Questions,
  ThreeProblems,
  Trust,
} from './VividSections'
import './vivid.css'

/**
 * The frame for the marketing pages split out of the home page (/how-it-works, /features,
 * /pricing, /about, /faq): the landing header and footer in the vivid look, a short page
 * title, then the sections that used to sit on /.
 */
export function MarketingPage({
  page,
  eyebrow,
  title,
  children,
}: {
  page: string
  eyebrow: string
  title: string
  children: ReactNode
}) {
  const { isAuthenticated } = useAuth()
  useEffect(() => {
    if (isAuthenticated) return
    track('landing_view', { ...currentUtm(), page })
  }, [isAuthenticated, page])

  return (
    <div className="lk-vivid">
      <SiteHeader signedIn={isAuthenticated} />
      <main className="vv-main">
        <div className="vv-bg" aria-hidden="true" />
        <header className="vv-page-head">
          <p className="vv-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </header>
        {children}
      </main>
      <div className="landing">
        <SiteFooter newsletter={false} />
      </div>
    </div>
  )
}

export function HowItWorksContent() {
  return (
    <>
      <ThreeProblems />
      <HowItWorks />
      <FamilyStory />
      <AcrossTheYear />
      <FinalCta />
    </>
  )
}

export function FeaturesContent() {
  return (
    <>
      <MomentCards />
      <Features />
      <BadDay />
      <FinalCta />
    </>
  )
}

export function PricingContent() {
  return (
    <>
      <Plans />
      <PlusBand />
      <FinalCta />
    </>
  )
}

export function AboutContent() {
  return (
    <>
      <Trust />
      <FinalCta />
    </>
  )
}

export function FaqContent() {
  return (
    <>
      <Questions />
      <FinalCta />
    </>
  )
}
