import { CAPABILITIES, MOMENTS } from './capabilities'
import './landing.css'
import './hero.css'
import './bands.css'

/** Drawn inline so the board does not depend on symbols rendered elsewhere on the page. */
function Lantern({ lit }: { lit: boolean }) {
  return (
    <svg viewBox="0 0 20 30" aria-hidden="true">
      <path
        d="M10 1 V5 M6 5 H14 L16 9 V21 L14 25 H6 L4 21 V9 Z M7 25 V28 H13 V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={lit ? undefined : '3 2.5'}
      />
      {lit && <circle cx="10" cy="15" r="3.4" fill="currentColor" />}
    </svg>
  )
}

/**
 * "Ready before. Found during. Sorted after." One column per moment, built from the
 * capabilities data. Live and Planned are text tags, and every Live item carries a
 * qualifier so Live is never read as always-on or unconditional.
 */
export function StoryBoard() {
  return (
    <section className="lk-band" id="story" aria-labelledby="lk-story-h">
      <p className="lk-eyebrow">One home for the family</p>
      <h2 id="lk-story-h">Ready before. Found during. Sorted after.</h2>
      <p className="lk-intro">
        LifeKeel is one platform for your family&rsquo;s picture, and it is useful at three
        different moments. New checks and tools join the same picture over time, and this is where
        you will see them arrive. Everything on it comes from what you add.
      </p>
      <div className="lk-moments">
        {MOMENTS.map((m) => (
          <article key={m.id} className={`lk-moment lk-m-${m.id}`}>
            <div className="lk-mood" aria-hidden="true" />
            <header>
              <h3>{m.name}</h3>
              <p>{m.line}</p>
            </header>
            <ul>
              {CAPABILITIES.filter((c) => c.moment === m.id).map((c) => (
                <li key={c.claim} className={c.live ? 'live' : 'planned'}>
                  <Lantern lit={c.live} />
                  <span>
                    {c.text}
                    {c.qualifier && <small className="lk-q">{c.qualifier}</small>}
                  </span>
                  <span className="lk-st">{c.live ? 'Live' : 'Planned'}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="lk-fine lk-key">
        Each capability joins the same chart, one at a time. <b>Live</b> means you can use it today,
        within the note beside it. It is not a promise that it covers everything. <b>Planned</b>{' '}
        means we intend to build it. Nothing planned is promised. Each adult gets their own view of
        the picture, and children get a simpler one.
      </p>
    </section>
  )
}
