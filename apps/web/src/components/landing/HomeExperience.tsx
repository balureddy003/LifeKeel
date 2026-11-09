'use client'

import { VividHero } from './VividHero'
import { FamilyStory } from './FamilyStory'
import { AcrossTheYear } from './AcrossTheYear'
import { MomentCards } from './MomentCards'
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
      <FamilyStory />
      <AcrossTheYear />
      <MomentCards />
      <Features />
      <BadDay />
      <div id="how-it-works">
        <ThreeProblems />
        <Trust />
        <HowItWorks />
      </div>
      <PlusBand />
      <StatStrip />
      <Plans />
      <Questions />
      <FinalCta />
    </main>
  )
}
