'use client'

import {
  ArrowRight,
  BadgePercent,
  CalendarClock,
  Check,
  FileText,
  HandCoins,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'

/**
 * The hero tells one story under one line: Know where to look. It says what the list holds,
 * that every adult is asked to confirm they have seen it, and what LifeKeel never does, then
 * shows a made-up family list. No calculation, no figures: those live further down the page.
 *
 * Claims this copy relies on (see claims.ts): family-list, every-adult-confirms,
 * no-commissions, no-money-moved, no-selling, free-plan. Why this headline, and why not
 * "The day someone needs it, it is already there": docs/research/brand-and-story-guide-2026-11-08.md.
 */

const TILES = [
  { icon: UsersRound, label: 'Adults', value: '2', tone: 'cyan' },
  { icon: UsersRound, label: 'Children', value: '2', tone: 'blue' },
  { icon: FileText, label: 'Policies', value: '2', tone: 'violet' },
  { icon: CalendarClock, label: 'Dates coming up', value: '2', tone: 'amber' },
] as const

const ON_THE_LIST = [
  { tone: 'amber', text: 'MOT due 14 March · Sam’s car' },
  { tone: 'violet', text: 'Life policy · held by Sam, covers Alex' },
  { tone: 'cyan', text: 'School fees start 1 September · Mia' },
] as const

const HAVE_LOOKED = ['Sam has looked', 'Alex has looked'] as const

export function VividHero() {
  return (
    <section className="vv-hero" aria-labelledby="vv-hero-h">
      <div className="vv-hero-copy">
        <p className="vv-chip">
          <UsersRound size={15} aria-hidden="true" />A shared family list
        </p>
        <h1 id="vv-hero-h">
          Know where <span className="vv-grad">to look.</span>
        </h1>
        <p className="vv-lede">
          One list for what your family would look for. Policies, cars, school dates and who to
          call. Every adult is asked to confirm they have seen it.
        </p>
        <div className="vv-hero-cta" id="signup">
          <a
            className="vv-btn"
            href={appUrl('/signup')}
            onClick={() => {
              haptic('light')
              track('landing_cta_click', { location: 'home_hero', method: 'signup' })
            }}
          >
            Start your family’s list
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          <a className="vv-btn vv-btn-ghost" href="#how-it-works">
            See how it works
          </a>
        </div>
        <p className="vv-fine">Free to start. No card needed.</p>
        <ul className="vv-hero-trust">
          <li>
            <BadgePercent size={16} aria-hidden="true" /> No commissions
          </li>
          <li>
            <HandCoins size={16} aria-hidden="true" /> Never moves money
          </li>
          <li>
            <ShieldCheck size={16} aria-hidden="true" /> Your details never sold
          </li>
        </ul>
        <p className="vv-signin">
          Already have an account?{' '}
          <a
            href={appUrl('/login')}
            onClick={() => track('landing_signin_click', { location: 'home_hero' })}
          >
            Sign in
          </a>
        </p>
        <p className="vv-legal">For adults, 18 and over. Information only, not regulated advice.</p>
      </div>

      <div className="vv-mock" aria-label="Sample family list, as shown in the app" role="img">
        <div className="vv-mock-glow" aria-hidden="true" />
        <div className="vv-mock-head">
          <span className="vv-mock-tag">Sample family list</span>
          <p className="vv-mock-hi">The Rivera family</p>
          <div className="vv-mock-stats">
            <div>
              <small>Every adult</small>
              <b>Seen by every adult</b>
            </div>
          </div>
        </div>
        <div className="vv-mock-tiles">
          {TILES.map(({ icon: Icon, label, value, tone }) => (
            <div key={label} className={`vv-tile vv-${tone}`}>
              <span className="vv-tile-icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <small>{label}</small>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <div className="vv-mock-list">
          <p>On the list</p>
          <ul>
            {ON_THE_LIST.map((n) => (
              <li key={n.text}>
                <span className={`vv-dot vv-${n.tone}`} />
                {n.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="vv-mock-list">
          <p>Who has looked</p>
          <ul>
            {HAVE_LOOKED.map((t) => (
              <li key={t}>
                <span className="vv-dot vv-green">
                  <Check size={11} aria-hidden="true" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="vv-mock-note">Made-up family. Made-up dates.</p>
      </div>
    </section>
  )
}
