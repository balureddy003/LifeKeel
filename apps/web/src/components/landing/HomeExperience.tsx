'use client'

import { LandingHero } from './LandingHero'
import { CostSection } from './CostSection'
import { TheList } from './TheList'
import { TwoStories } from './TwoStories'
import { DifficultDay } from './DifficultDay'
import { ThroughTheYear } from './ThroughTheYear'
import { TrustAct } from './TrustAct'
import { MomentCards } from './MomentCards'
import { Begin } from './Begin'
import {
  BadDay,
  Features,
  HowItWorks,
  Plans,
  PlusBand,
  Questions,
  StatStrip,
  ThreeProblems,
} from './VividSections'
import './vivid.css'

export function HomeExperience() {
  return (
    <main className="vv-main">
      <div className="vv-bg" aria-hidden="true" />
      {/* The cinematic opening shot — paper hero + sample-list prop.
          The rest of the home page chrome (CostSection, DifficultDay, etc.)
          is unchanged and still rides the vivid story system. */}
      <div className="lk-paper-band">
        <LandingHero />
      </div>
      <CostSection />
      {/* Scroll 2: the list as character — the same sheet closer, with the
          honest line. Sits between the cost and the difficult day so the
          page answers "what is the point of a list?" before it is tested. */}
      <TheList />
      {/* The fork: a household list looks for what is missing; a team list
          looks for what only one person knows. The story is not the same
          from here, so the two panels stop being a mirror. */}
      <TwoStories />
      {/* Scroll 3: the same list under pressure, family and team side by side. */}
      <DifficultDay />
      {/* Scroll 4: the same list on ordinary weeks, through the year. */}
      <ThroughTheYear />
      <MomentCards />
      {/* Scroll 5: the trust act — seven promises, each backed by a live claim. */}
      <TrustAct />
      <Features />
      <BadDay />
      <div id="how-it-works">
        <ThreeProblems />
        <HowItWorks />
      </div>
      <PlusBand />
      <StatStrip />
      <Plans />
      <Questions />
      {/* The closing breath, not a button — and back on paper, so the film
          opens on a sheet and ends on one. */}
      <div className="lk-paper-band">
        <Begin />
      </div>
    </main>
  )
}
