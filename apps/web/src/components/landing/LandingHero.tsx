'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Check, FileText, Heart, ShieldCheck, Wallet } from 'lucide-react'
import { SAMPLE_FAMILY, SCENARIOS, RUNWAY_CAP, gbp, runwayMonths } from './scenarios'
import { useCountUp, useLandingMotion } from './motion'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import './landing.css'
import './hero.css'

const AUTO = [1, 0, 2, 3]

function Runway({ months, on }: { months: number; on: boolean }) {
  const counted = useCountUp(Math.min(months, RUNWAY_CAP), on)
  return <>{months === Infinity ? 'Covered' : months >= RUNWAY_CAP ? '24+' : counted.toFixed(1)}</>
}

export function LandingHero() {
  const { on, paused, toggle } = useLandingMotion()
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(true)
  const scene = useRef<HTMLElement>(null)
  const scn = SCENARIOS[AUTO[step]!]!
  const calc = scn.calc(SAMPLE_FAMILY)
  const months = runwayMonths(calc)

  useEffect(() => {
    const el = scene.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((entries) => setVisible(entries[0]!.isIntersecting), {
      threshold: 0.1,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!on || !visible) return
    const timer = setInterval(() => {
      if (!document.hidden) setStep((current) => (current + 1) % AUTO.length)
    }, 6500)
    return () => clearInterval(timer)
  }, [on, visible])

  return (
    <div className="landing">
      <section
        ref={scene}
        className="lk-modern-hero"
        aria-labelledby="lk-h1"
        data-visible={visible}
      >
        <div className="lk-modern-copy">
          <span className="lk-hero-label">
            <span /> A little planning. A lot more clarity.
          </span>
          <h1 id="lk-h1">
            Life gets busy.
            <br />
            Stay one step <span>ready.</span>
          </h1>
          <p>
            Your savings, cover and important papers. Finally in one place, so your family knows
            what&rsquo;s there — and what to do next.
          </p>
          <a
            id="signup"
            className="lk-btn lk-modern-cta"
            href={appUrl('/signup')}
            onClick={() => {
              haptic('light')
              track('landing_cta_click', { location: 'hero', method: 'signup' })
            }}
          >
            Start your family&rsquo;s plan <ArrowUpRight size={20} aria-hidden="true" />
          </a>
          <div className="lk-hero-perks">
            <span>
              <Check size={15} aria-hidden="true" /> Free to start
            </span>
            <span>
              <Check size={15} aria-hidden="true" /> No commissions
            </span>
          </div>
          <a className="lk-hero-explore" href="#how-it-works">
            See how it works <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
        <div className="lk-dashboard-wrap">
          <div className="lk-dashboard" aria-label="Illustrative family dashboard">
            <div className="lk-dash-top">
              <span className="lk-dash-symbol">
                <Heart size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>Your family, in view.</strong>
                <span>The Ellis family · Illustrative example</span>
              </div>
              <span className="lk-sample-tag">SAMPLE</span>
            </div>
            <div className="lk-dash-welcome">
              <h2>
                A clearer picture.
                <br />A calmer next step.
              </h2>
              <div className="lk-avatars" aria-hidden="true">
                <span>P</span>
                <span>S</span>
                <span>M</span>
                <span>L</span>
              </div>
            </div>
            <div className="lk-dash-stats">
              <div>
                <Wallet size={18} aria-hidden="true" />
                <span>Savings on file</span>
                <strong>{gbp(SAMPLE_FAMILY.savings)}</strong>
                <small>Your family&rsquo;s buffer</small>
              </div>
              <div>
                <ShieldCheck size={18} aria-hidden="true" />
                <span>Cover on file</span>
                <strong>{gbp(SAMPLE_FAMILY.cover)}</strong>
                <small>Held by the provider</small>
              </div>
            </div>
            <div className="lk-dash-scenario">
              <div className="lk-dash-section-head">
                <span>WHAT IF LIFE CHANGES?</span>
                <button type="button" onClick={toggle}>
                  {paused ? 'Play examples' : 'Pause examples'}
                </button>
              </div>
              <label htmlFor="lk-hero-scenario" className="lk-sr">
                Choose a sample scenario
              </label>
              <select
                id="lk-hero-scenario"
                value={step}
                onChange={(event) => setStep(Number(event.target.value))}
              >
                {AUTO.map((scenario, index) => (
                  <option key={scenario} value={index}>
                    {SCENARIOS[scenario]!.chip}
                  </option>
                ))}
              </select>
              <div className="lk-dash-runway">
                <div>
                  <strong aria-hidden="true">
                    <Runway months={months} on={on} />
                  </strong>
                  <span className="lk-sr">
                    Savings last about {Math.min(months, RUNWAY_CAP).toFixed(1)} months in this
                    sample scenario.
                  </span>
                  <span>
                    months of savings
                    <br />
                    at this monthly gap
                  </span>
                </div>
                <span className="lk-runway-icon">
                  <ArrowUpRight size={26} aria-hidden="true" />
                </span>
              </div>
              <div className="lk-buffer-track" role="presentation">
                <span style={{ width: `${Math.min(months / RUNWAY_CAP, 1) * 100}%` }} />
              </div>
              <p>{calc.note} An example, not your figures.</p>
            </div>
            <div className="lk-dash-next">
              <span className="lk-dash-file">
                <FileText size={19} aria-hidden="true" />
              </span>
              <div>
                <strong>A useful next step</strong>
                <span>Check your income protection is on file.</span>
              </div>
              <ArrowRight size={18} aria-hidden="true" />
            </div>
          </div>
          <div className="lk-dash-caption">
            <span /> Built around your people. Informed by your information.
          </div>
        </div>
      </section>
      <div className="lk-hero-strip">
        <span>Less searching. More living.</span>
        <span>
          <Wallet size={17} aria-hidden="true" /> Savings &amp; spending
        </span>
        <span>
          <ShieldCheck size={17} aria-hidden="true" /> Cover &amp; protection
        </span>
        <span>
          <FileText size={17} aria-hidden="true" /> Papers &amp; plans
        </span>
      </div>
    </div>
  )
}
