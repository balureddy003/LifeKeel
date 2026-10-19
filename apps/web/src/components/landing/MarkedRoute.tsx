'use client'

import { useEffect, useRef, useState } from 'react'
import { ROUTE } from './route'
import { Lantern } from './Lantern'
import { useLandingMotion } from './motion'
import { wavePath } from './waves'
import './landing.css'
import './hero.css'
import './bands.css'

const GUIDE =
  'M70 150 C150 70 200 120 240 96 S330 60 380 74 S470 118 530 104 S620 52 680 64 S780 110 830 96 S900 70 940 72'
const BACK = wavePath({ amp: 5, n: 3, base: 162, ph: 0 }, 220, 1000).fill
const FRONT = wavePath({ amp: 6, n: 4, base: 176, ph: 1.4 }, 220, 1000).fill

/**
 * A preview of the planned single list of next steps: a course drawn as the page
 * scrolls, lanterns lighting as the boat reaches them. With motion off, or when the
 * figure is already on screen at load, it is shown complete.
 */
export function MarkedRoute() {
  const { on } = useLandingMotion()
  const fig = useRef<HTMLElement>(null)
  const [armed, setArmed] = useState(false)
  const [p, setP] = useState(1)

  useEffect(() => {
    const el = fig.current
    if (!el || !on) {
      setArmed(false)
      setP(1)
      return
    }
    if (el.getBoundingClientRect().top < window.innerHeight) {
      setP(1)
      return
    }
    setArmed(true)
    setP(0)
    let tick = false
    const run = () => {
      tick = false
      const r = el.getBoundingClientRect()
      const h = window.innerHeight
      setP(Math.max(0, Math.min(1, (h * 0.9 - r.top) / (h * 0.55))))
    }
    const onScroll = () => {
      if (!tick) {
        tick = true
        requestAnimationFrame(run)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [on])

  const prog = armed && on ? p : 1

  return (
    <section className="lk-band" id="route" aria-labelledby="lk-route-h">
      <p className="lk-eyebrow">Planned: the next steps, in order</p>
      <h2 id="lk-route-h">One short list, in a fixed order.</h2>
      <p className="lk-intro">
        Today Keel shows these in different places: reminders, checks and steps. A single ordered
        list is planned. This is how it will be ordered: dated items first, soonest first, then
        checks in the same order every time. It will not rank what matters most, because Keel cannot
        know that.
      </p>
      <figure
        ref={fig}
        className="lk-routefig"
        aria-label="A sample course with six waypoints, drawn as the page scrolls"
      >
        <svg viewBox="0 0 1000 220" aria-hidden="true">
          <defs>
            <linearGradient id="lk-rsky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--sky-a)' }} />
              <stop offset="1" style={{ stopColor: 'var(--sky-b)' }} />
            </linearGradient>
            <linearGradient id="lk-rsea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--wave)' }} />
              <stop offset="1" style={{ stopColor: 'var(--wave-3)' }} />
            </linearGradient>
            <clipPath id="lk-rclip">
              <rect x="0" y="0" width={Math.round(prog * 1000)} height="220" />
            </clipPath>
          </defs>
          <rect width="1000" height="220" fill="url(#lk-rsky)" />
          <path d={BACK} fill="url(#lk-rsea)" opacity=".55" />
          <path
            d={GUIDE}
            fill="none"
            stroke="var(--muted)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="0.1 11"
            opacity=".4"
          />
          <g clipPath="url(#lk-rclip)">
            <path
              d={GUIDE}
              fill="none"
              stroke="var(--brass-text)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="0.1 11"
            />
          </g>
          {ROUTE.map((c, i) => {
            const lit = prog * 1000 >= c.x - 12
            return (
              <use
                key={c.title}
                className={`lk-wl${lit ? ' lit' : ''}${c.live ? '' : ' pl'}`}
                href={c.live ? '#lk-lantern' : '#lk-lantern-off'}
                x={c.x - 12}
                y={[56, 30, 64, 24, 56, 32][i]}
                width="24"
                height="36"
              />
            )
          })}
          <path d={FRONT} fill="url(#lk-rsea)" />
          <g transform={`translate(${Math.round(70 + prog * 790)} 154)`}>
            <use href="#lk-boat" x="-34" y="-76" width="68" height="79" />
          </g>
        </svg>
      </figure>
      <ol className="lk-routelist">
        {ROUTE.map((c) => (
          <li key={c.title} className={`lk-rcard${c.live ? '' : ' planned'}`}>
            <div className="lk-rhead">
              <span className="lk-rtype">
                <Lantern lit={c.live} className="lk-rln" />
                {c.kind}
              </span>
              <span className="lk-st">{c.live ? 'Live' : 'Planned'}</span>
            </div>
            <h3>{c.title}</h3>
            <dl>
              <div>
                <dt>On file</dt>
                <dd>{c.onFile}</dd>
              </div>
              <div>
                <dt>Needs from you</dt>
                <dd>{c.needs}</dd>
              </div>
              <div>
                <dt>{c.live ? 'Keel does' : 'Keel will'}</dt>
                <dd>{c.does}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <p className="lk-fine lk-key">
        Sample family and made-up dates. The course above is a preview of the planned list, and each
        card carries its own Live or Planned tag for the thing it describes.
      </p>
    </section>
  )
}
