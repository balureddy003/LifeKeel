'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SAMPLE_FAMILY, SCENARIOS, RUNWAY_CAP, runwayMonths, seaState } from './scenarios'
import { useCountUp, useLandingMotion } from './motion'
import { LandingSymbols } from './LandingSymbols'
import { SeaBackdrop, SeaFront } from './SeaBackdrop'
import { HarbourChart } from './HarbourChart'
import { SignupCard } from './SignupCard'
import './landing.css'
import './hero.css'

const BAND_LABEL = { rough: 'Under 3 months', holding: '3 to 6 months', steady: '6 months or more' }
const HEEL = { rough: '-14deg', holding: '-5deg', steady: '0deg' }
/** Order the hero cycles through the four sample bad days. */
const AUTO = [1, 0, 2, 3]
const AUTO_MS = 6500

function fmt(m: number): string {
  return m >= RUNWAY_CAP ? `${RUNWAY_CAP}+` : m.toFixed(1)
}

export function LandingHero() {
  const { on, paused, toggle } = useLandingMotion()
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(true)
  const scene = useRef<HTMLElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(330)

  const scn = SCENARIOS[AUTO[step]!]!
  const calc = scn.calc(SAMPLE_FAMILY)
  const months = runwayMonths(calc)
  const level = seaState(months)
  const counted = useCountUp(Math.min(months, RUNWAY_CAP), on)

  // Cycle the sample days only while the hero is on screen, the tab is awake and motion is on.
  useEffect(() => {
    const el = scene.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((es) => setVisible(es[0]!.isIntersecting), {
      threshold: 0.1,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!on || !visible) return
    const t = setInterval(() => {
      if (!document.hidden) setStep((s) => (s + 1) % AUTO.length)
    }, AUTO_MS)
    return () => clearInterval(t)
  }, [on, visible])

  // On phones the sea stops above the signup card; keep that offset in step with the card's height.
  useLayoutEffect(() => {
    const el = card.current
    if (!el || !('ResizeObserver' in window)) return
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight + 46))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const shown = months === Infinity ? 'Not drawn on' : fmt(counted)
  const spoken =
    months === Infinity
      ? 'income still covers spending'
      : `savings last about ${months >= RUNWAY_CAP ? `more than ${RUNWAY_CAP}` : months.toFixed(1)} months`

  return (
    <div className="landing">
      <LandingSymbols />
      <section
        ref={scene}
        className={`lk-scene ${level}`}
        aria-labelledby="lk-h1"
        style={{ '--heel': HEEL[level], '--cardh': `${cardH}px` } as React.CSSProperties}
      >
        <SeaBackdrop />

        <div className="lk-copy">
          <span className="lk-eyebrow">Free to start. Optional paid plan later.</span>
          <h1 id="lk-h1">
            Your family&rsquo;s chart, <em>kept current.</em>
          </h1>
          <p className="lk-lede">
            One home for your family&rsquo;s savings, cover and papers. Tell LifeKeel what you have
            on file and it shows what is there, what is missing, and the steps if something happens.
            No commissions.
          </p>
        </div>

        <div className="lk-stage">
          <div className="lk-readout">
            <div className="lk-read">
              <small>Sample family: {scn.chip.toLowerCase()}</small>
              <span aria-hidden="true">{shown}</span>
              {months !== Infinity && (
                <span className="u" aria-hidden="true">
                  months
                </span>
              )}
            </div>
            <span className={`lk-pill ${level}`}>{BAND_LABEL[level]}</span>
            <div className="lk-ctl">
              <span className="lk-fine">The sample Ellis family: two adults, two children</span>
              <button className="lk-pause" type="button" aria-pressed={paused} onClick={toggle}>
                {paused ? 'Play animation' : 'Pause animation'}
              </button>
            </div>
            <p className="lk-sr">
              Sample family, {scn.chip.toLowerCase()}: {spoken}. Band: {BAND_LABEL[level]}. An
              example, not your figures.
            </p>
          </div>
          <HarbourChart />
        </div>

        <SeaFront />
        <div ref={card} className="lk-cardwrap">
          <SignupCard />
        </div>
      </section>
    </div>
  )
}
