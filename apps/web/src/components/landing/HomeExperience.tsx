'use client'

import { VividHero } from './VividHero'
import { SampleDay } from './SampleDay'
import {
  BadDay,
  Features,
  FinalCta,
  HowItWorks,
  Plans,
  PlusBand,
  Questions,
  StatStrip,
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
        <HowItWorks />
        <div className="landing vv-sample">
          <SampleDay />
        </div>
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
