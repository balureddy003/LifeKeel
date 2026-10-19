'use client'

import { useEffect, useRef, useState } from 'react'
import { YEARS, YEAR_ITEMS } from './years'
import { Lantern } from './Lantern'
import { useLandingMotion } from './motion'
import { wavePath } from './waves'
import './landing.css'
import './hero.css'
import './bands.css'

const BACK = wavePath({ amp: 5, n: 3, base: 214, ph: 0 }, 300, 1000).fill
const FRONT = wavePath({ amp: 6, n: 4, base: 236, ph: 1.4 }, 300, 1000).fill
const STEP_MS = 3200

/**
 * The same chart at four stages of life. Native radios choose the stage; when the
 * figure first scrolls into view and motion is on it steps through the stages once.
 * Choosing a stage ends the auto-play. Planned items are dashed and tagged Planned.
 */
export function YearsTimelapse() {
  const { on } = useLandingMotion()
  const fig = useRef<HTMLElement>(null)
  const [stage, setStage] = useState(1)
  const [auto, setAuto] = useState(true)
  const [started, setStarted] = useState(false)
  const [announce, setAnnounce] = useState('')
  const y = YEARS[stage - 1]!
  const fresh = YEAR_ITEMS.filter((i) => i.stage === stage)

  useEffect(() => {
    const el = fig.current
    if (!el || !on || !auto || started || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      (es) => {
        if (es[0]!.isIntersecting) {
          setStarted(true)
          io.disconnect()
        }
      },
      { threshold: 0.55 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [on, auto, started])

  useEffect(() => {
    if (!started || !auto || !on || stage >= 4) return
    const t = setTimeout(() => setStage((s) => s + 1), STEP_MS)
    return () => clearTimeout(t)
  }, [started, auto, on, stage])

  const pick = (n: number) => {
    setAuto(false)
    setStage(n)
    const yr = YEARS[n - 1]!
    const items = YEAR_ITEMS.filter((i) => i.stage === n)
    setAnnounce(
      `${yr.name}. ${yr.line} New on the chart: ${items
        .map((i) => `${i.text} (${i.live ? 'Live' : 'Planned'})`)
        .join('; ')}.`,
    )
  }

  return (
    <section className="lk-band" id="years" aria-labelledby="lk-years-h">
      <p className="lk-eyebrow">As the years go by</p>
      <h2 id="lk-years-h">The same chart, as life changes.</h2>
      <p className="lk-intro">
        You do not start again when life changes. You add to the chart. Items that are planned
        arrive as dashed outlines and are never described as available.
      </p>
      <fieldset className="lk-yrs-set">
        <legend>Pick a stage</legend>
        <div className="lk-yrs">
          {YEARS.map((yr, i) => (
            <div className="lk-opt" key={yr.name}>
              <input
                type="radio"
                name="lk-yr"
                id={`lk-yr-${i + 1}`}
                checked={stage === i + 1}
                onChange={() => pick(i + 1)}
              />
              <label htmlFor={`lk-yr-${i + 1}`}>{yr.name}</label>
            </div>
          ))}
        </div>
      </fieldset>
      <figure
        ref={fig}
        className={`lk-routefig lk-yrfig lk-yr-${stage}`}
        aria-label="A sample family at four stages of life, with the chart growing"
      >
        <svg viewBox="0 0 1000 300" aria-hidden="true">
          <defs>
            <linearGradient id="lk-ysky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--sky-a)' }} />
              <stop offset="1" style={{ stopColor: 'var(--sky-b)' }} />
            </linearGradient>
            <linearGradient id="lk-ysea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--wave)' }} />
              <stop offset="1" style={{ stopColor: 'var(--wave-3)' }} />
            </linearGradient>
          </defs>
          <rect width="1000" height="300" fill="url(#lk-ysky)" />
          {[1, 2, 3, 4].map((n) => (
            <rect key={n} className={`lk-ssn lk-sn${n}`} width="1000" height="300" />
          ))}
          <circle className="lk-sun" cx="0" cy="0" r="20" />
          <g>
            {YEAR_ITEMS.map((it, i) => (
              <use
                key={it.text}
                className={`lk-yl${it.live ? '' : ' pl'}${it.stage <= stage ? ' in' : ''}`}
                href={it.live ? '#lk-lantern' : '#lk-lantern-off'}
                x={110 + i * 112}
                y={58 + (i % 2) * 22}
                width="26"
                height="39"
              />
            ))}
          </g>
          <path d={BACK} fill="url(#lk-ysea)" opacity=".55" />
          {[200, 360, 520, 680].map((b) => (
            <path
              key={b}
              className="lk-ys"
              data-b={b}
              d={`M${b - 54} 203 V226 H${b + 54} V203`}
              pathLength="1"
              fill="none"
            />
          ))}
          {['priya', 'sam', 'mia', 'leo'].map((n) => (
            <g key={n} className={`lk-yb ${n}`}>
              <use href="#lk-boat" x="-60" y="-137" width="120" height="140" />
            </g>
          ))}
          <path d={FRONT} fill="url(#lk-ysea)" />
        </svg>
      </figure>
      <div className="lk-yrcap">
        <div>
          <p className="lk-eyebrow">{y.season}</p>
          <h3>{y.name}</h3>
          <p>{y.line}</p>
        </div>
        <div>
          <p className="lk-eyebrow">New on the chart at this stage</p>
          <ul className="lk-yrnew">
            {fresh.map((it) => (
              <li key={it.text} className={it.live ? 'live' : 'planned'}>
                <Lantern lit={it.live} />
                <span>{it.text}</span>
                <span className="lk-st">{it.live ? 'Live' : 'Planned'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="lk-fine lk-key" role="status">
        {announce ||
          'A sample family over the years. Nothing here predicts how your family will change, and Keel does not know.'}
      </p>
    </section>
  )
}
