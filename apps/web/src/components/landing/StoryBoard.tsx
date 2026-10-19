import { CAPABILITIES, MOMENTS } from './capabilities'
import './landing.css'
import './hero.css'
import './bands.css'

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
                  <svg viewBox="0 0 20 30" aria-hidden="true">
                    <use href={c.live ? '#lk-lantern' : '#lk-lantern-off'} />
                  </svg>
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
