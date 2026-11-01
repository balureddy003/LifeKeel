'use client'

import {
  ArrowRight,
  BadgePercent,
  CalendarClock,
  Check,
  CircleAlert,
  FileText,
  HandCoins,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { SAMPLE_FAMILY, SCENARIOS, gbp, runwayMonths } from './scenarios'

const incomeStopsMonths = runwayMonths(SCENARIOS[0]!.calc(SAMPLE_FAMILY))

const TILES = [
  { icon: UsersRound, label: 'On the roster', value: '4', tone: 'cyan' },
  { icon: FileText, label: 'Papers on file', value: '6', tone: 'blue' },
  { icon: CalendarClock, label: 'Renewing soon', value: '1', tone: 'violet' },
  { icon: CircleAlert, label: 'Open checks', value: '2', tone: 'amber' },
] as const

const NOTICED = [
  { tone: 'amber', text: 'Income protection is not on file' },
  { tone: 'violet', text: 'Home policy renews in 21 days' },
  { tone: 'green', text: 'Wills added for both adults' },
] as const

/** The hero: one promise, two ways in, and a made-up household drawn as the app shows it. */
export function VividHero() {
  return (
    <section className="vv-hero" aria-labelledby="vv-hero-h">
      <div className="vv-hero-copy">
        <p className="vv-chip">
          <Sparkles size={15} aria-hidden="true" />
          Free to start. No card needed.
        </p>
        <h1 id="vv-hero-h">
          One money question. One number. <span className="vv-grad">Both of you.</span>
        </h1>
        <p className="vv-lede">
          Pick the problem in front of your household: an income that stops or drops, a mortgage fix
          ending, fees starting. Enter a few figures and Keel gives one answer in months, with the
          date it depends on. Send it to the other adult and you will see when they have opened it.
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
            Start your first brief. It is free.
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          <a className="vv-btn vv-btn-ghost" href="#problems">
            See the six problems
          </a>
        </div>
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
        <p className="vv-legal">
          For adults, 18 and over. Already have an account?{' '}
          <a
            href={appUrl('/login')}
            onClick={() => track('landing_signin_click', { location: 'home_hero' })}
          >
            Sign in
          </a>
          . Information only, not regulated advice.
        </p>
      </div>

      <div className="vv-mock" aria-label="Sample household, as shown in the app" role="img">
        <div className="vv-mock-glow" aria-hidden="true" />
        <div className="vv-mock-head">
          <span className="vv-mock-tag">Sample household</span>
          <p className="vv-mock-hi">Good morning, the Rivera family</p>
          <div className="vv-mock-stats">
            <div>
              <small>If income stops</small>
              <b>{incomeStopsMonths.toFixed(1)} months</b>
            </div>
            <div>
              <small>Life cover on file</small>
              <b>{gbp(SAMPLE_FAMILY.cover)}</b>
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
          <p>What Keel noticed</p>
          <ul>
            {NOTICED.map((n) => (
              <li key={n.text}>
                <span className={`vv-dot vv-${n.tone}`}>
                  {n.tone === 'green' && <Check size={11} aria-hidden="true" />}
                </span>
                {n.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="vv-mock-note">Made-up figures for a sample household.</p>
      </div>
    </section>
  )
}
