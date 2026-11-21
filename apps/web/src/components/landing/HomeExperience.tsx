'use client'

import { VividHero } from './VividHero'
import { Explore, PlansTeaser, PromisesTeaser } from './HomeSections'
import { FinalCta, HowItWorks, StatStrip } from './VividSections'
import './vivid.css'

/** The short home page. The detail lives on /how-it-works, /features, /pricing, /about and /faq. */
export function HomeExperience() {
  return (
    <main className="vv-main">
      <div className="vv-bg" aria-hidden="true" />
      <VividHero />
      <StatStrip />
      <Explore />
      <HowItWorks more />
      <PromisesTeaser />
      <PlansTeaser />
      <FinalCta />
    </main>
  )
}
