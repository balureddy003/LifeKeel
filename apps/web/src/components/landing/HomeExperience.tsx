'use client'

import {
  FileText,
  FolderHeart,
  Heart,
  Mail,
  ShieldCheck,
  UsersRound,
  Wallet,
  Waypoints,
} from 'lucide-react'
import { LandingSymbols } from './LandingSymbols'
import { SignupCard } from './SignupCard'
import { SampleDay } from './SampleDay'
import { YearsTimelapse } from './YearsTimelapse'
import { StoryBoard } from './StoryBoard'
import { CoverOnFile } from './CoverOnFile'
import { CrisisSteps } from './CrisisSteps'
import { Promises } from './Promises'
import { Security } from './Security'
import { PlusSpotlight } from './PlusSpotlight'
import { Pricing } from './Pricing'
import { Faq } from './Faq'
import { DawnClose } from './DawnClose'
import './home.css'

export function HomeExperience() {
  return (
    <main className="lk-home-content">
      <LandingSymbols />
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-floating-icons" aria-hidden="true">
          {[Wallet, ShieldCheck, FolderHeart, UsersRound, Heart, FileText, Mail, Waypoints].map(
            (Icon, index) => (
              <span key={index}>
                <Icon size={29} strokeWidth={1.7} />
              </span>
            ),
          )}
        </div>
        <div className="home-hero-copy">
          <span className="home-kicker">Free to start. Optional paid plan later.</span>
          <h1 id="home-title">
            Your family’s chart,
            <br />
            kept current.
          </h1>
          <p>
            One home for your family’s savings, cover and papers. Tell LifeKeel what you have on
            file and it shows what is there, what is missing, and the steps if something happens. No
            commissions.
          </p>
          <div className="landing home-live-signup">
            <SignupCard location="home_hero" />
          </div>
        </div>
      </section>
      <div className="landing">
        <div id="how-it-works">
          <SampleDay />
        </div>
        <YearsTimelapse />
        <div id="features">
          <StoryBoard />
        </div>
        <CoverOnFile />
        <CrisisSteps />
        <Promises />
        <Security />
        <PlusSpotlight />
        <Pricing />
        <Faq />
        <DawnClose />
      </div>
    </main>
  )
}
