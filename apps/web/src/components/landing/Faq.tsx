import { FAQ } from './faq-data'
import './landing.css'
import './hero.css'
import './bands.css'

export function Faq() {
  return (
    <section className="lk-band" id="faq" aria-labelledby="lk-faq-h">
      <p className="lk-eyebrow">Common questions</p>
      <h2 id="lk-faq-h">Straight answers.</h2>
      <div className="lk-faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
