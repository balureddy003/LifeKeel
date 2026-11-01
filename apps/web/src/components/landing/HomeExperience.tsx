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
        <Trust />
        <HowItWorks />
      </div>
      <PlusBand />
      <Plans />
      <BadDay />
      <Features />
      <Questions />
      <FinalCta />
    </main>
  )
}
