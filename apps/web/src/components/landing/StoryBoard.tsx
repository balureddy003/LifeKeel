import { Lantern } from './Lantern'
import { CAPABILITIES, MOMENTS } from './capabilities'
import './landing.css'
import './hero.css'
import './bands.css'

/** Only what is available today. Planned work is not shown on the public site (it lives in the app). */
const AVAILABLE = CAPABILITIES.filter((c) => c.live)

/**
 * "Ready before. Found during. Sorted after." One column per moment, built from the
 * capabilities data. Every item carries a note saying what it depends on, so nothing
 * reads as always-on or unconditional.
 */
export function StoryBoard() {
  return (
    <section className="lk-band" id="story" aria-labelledby="lk-story-h">
      <p className="lk-eyebrow">One home for the family</p>
      <h2 id="lk-story-h">Ready before. Found during. Sorted after.</h2>
      <p className="lk-intro">
        LifeKeel is one platform for your family&rsquo;s picture, and it is useful at three
        different moments. Everything on it comes from what you add.
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
              {AVAILABLE.filter((c) => c.moment === m.id).map((c) => (
                <li key={c.claim}>
                  <Lantern lit />
                  <span>
                    {c.text}
                    {c.qualifier && <small className="lk-q">{c.qualifier}</small>}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="lk-fine lk-key">
        Each adult gets their own view of the picture, and children get a simpler one. Each item
        works within the note beside it; none of them covers everything.
      </p>
    </section>
  )
}
