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
import './home-refresh.css'
import './home-sections.css'

export function HomeExperience() {
  return (
    <main className="lk-home-content">
      <LandingSymbols />
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <span className="home-kicker">Free to start. Optional paid plan later.</span>
          <h1 id="home-title">
            Your family’s chart,
            <br />
            <span className="home-gradient-text">kept current.</span>
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
        <div className="home-chart-art" aria-hidden="true">
          <div className="home-chart-orbit" />
          <div className="home-chart-orbit home-chart-orbit-inner" />
          <svg className="home-chart-lines" viewBox="0 0 480 480" fill="none">
            <path d="M240 240 110 92M240 240 355 75M240 240 410 220M240 240 355 390M240 240 125 400M240 240 55 250" />
          </svg>
          <div className="home-chart-center">
            <UsersRound size={58} strokeWidth={1.4} />
          </div>
          {[Wallet, ShieldCheck, FolderHeart, Heart, FileText, Mail].map((Icon, index) => (
            <div className={`home-chart-node home-chart-node-${index + 1}`} key={index}>
              <Icon size={31} strokeWidth={1.6} />
              <span />
              <span />
            </div>
          ))}
          <div className="home-chart-seal">
            <Waypoints size={23} />
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
