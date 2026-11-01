'use client'

import { VividHero } from './VividHero'
import {
  BadDay,
  Features,
  FinalCta,
  HowItWorks,
  Plans,
  PlusBand,
  Questions,
  StatStrip,
  ThreeProblems,
  Trust,
} from './VividSections'
import './vivid.css'

export function HomeExperience() {
  return (
    <main className="vv-main">
      <div className="vv-bg" aria-hidden="true" />
      <VividHero />
      <StatStrip />
      <div id="how-it-works">
        <ThreeProblems />
        <HowItWorks />
      </div>
      <Features />
      <BadDay />
      <PlusBand />
      <Trust />
      <Plans />
      <Questions />
      <FinalCta />
    </main>
  )
}
