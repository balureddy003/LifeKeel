'use client'

import { useState } from 'react'
import { SAMPLE_FAMILY, SCENARIOS, RUNWAY_CAP, gbp, runwayMonths, seaState } from './scenarios'
import './landing.css'
import './hero.css'
import './bands.css'

const BAND_LABEL = { rough: 'Under 3 months', holding: '3 to 6 months', steady: '6 months or more' }

function fmt(m: number): string {
  return m >= RUNWAY_CAP ? `${RUNWAY_CAP}+` : m.toFixed(1)
}

/**
 * A read-only sample day: pick one of four bad days and see what Keel would check
 * for a made-up household. Native radios, no inputs that take the visitor's data.
 */
export function SampleDay() {
  const [cur, setCur] = useState(1)
  const [announce, setAnnounce] = useState('')
  const s = SCENARIOS[cur]!
  const c = s.calc(SAMPLE_FAMILY)
  const gap = Math.max(c.spend - c.income, 0)
  const months = runwayMonths(c)
  const level = seaState(months)

  const pick = (i: number) => {
    setCur(i)
    const sc = SCENARIOS[i]!
    const m = runwayMonths(sc.calc(SAMPLE_FAMILY))
    setAnnounce(
      `Sample family, ${sc.chip.toLowerCase()}: ${
        m === Infinity
          ? 'income still covers spending.'
          : `savings last ${m >= RUNWAY_CAP ? `more than ${RUNWAY_CAP}` : `about ${m.toFixed(1)}`} months.`
      } Band: ${BAND_LABEL[seaState(m)]}.`,
    )
  }

  return (
    <section className="lk-band" id="sample" aria-labelledby="lk-sample-h">
      <p className="lk-eyebrow">A sample family</p>
      <h2 id="lk-sample-h">Four bad days, and what Keel would check.</h2>
      <p className="lk-intro">
        This is a made-up household with {gbp(SAMPLE_FAMILY.savings)} in savings,{' '}
        {gbp(SAMPLE_FAMILY.spend)} of monthly spending and {gbp(SAMPLE_FAMILY.cover)} of life cover
        on file. Nothing here asks about you.
      </p>
      <div className="lk-sample-grid">
        <div>
          <fieldset>
            <legend>Pick a day</legend>
            <div className="lk-opts">
              {SCENARIOS.map((sc, i) => (
                <div className="lk-opt" key={sc.id}>
                  <input
                    type="radio"
                    name="lk-scn"
                    id={`lk-scn-${i}`}
                    checked={i === cur}
                    onChange={() => pick(i)}
                  />
                  <label htmlFor={`lk-scn-${i}`}>{sc.chip}</label>
                </div>
              ))}
            </div>
          </fieldset>
          <p className="lk-hard">{s.hard ?? ''}</p>
          <div className="lk-mini">
            <b>{months === Infinity ? 'Not drawn on' : fmt(months)}</b>
            {months !== Infinity && <span>months</span>}
            <span className={`lk-pill ${level}`}>{BAND_LABEL[level]}</span>
          </div>
          <p className="lk-fine">Keel&rsquo;s bands, not a rating.</p>
          <p className="lk-sr" role="status">
            {announce}
          </p>
        </div>
        <div className="lk-plan">
          <h3>{s.title}</h3>
          <p className="lk-note">{c.note}</p>
          <ol>
            {s.steps(SAMPLE_FAMILY).map((t, i) => (
              <li key={i}>
                <b>{s.tags[i]}</b>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <p className="lk-maths">
            {gap === 0
              ? `Monthly gap = ${gbp(c.spend)} spending - ${gbp(c.income)} income = £0, so savings are not drawn on.`
              : `Runway = ${gbp(c.fund)} / (${gbp(c.spend)} spending - ${gbp(c.income)} income) = ${months.toFixed(1)} months${months >= RUNWAY_CAP ? ` (drawn as ${RUNWAY_CAP}+)` : ''}. Common rules of thumb run from 3 to 6 months. Yours may differ.`}
          </p>
          <p className="lk-own">
            Sample figures for a made-up household. After you sign up, Keel uses only what you tell
            it.
          </p>
        </div>
      </div>
    </section>
  )
}
