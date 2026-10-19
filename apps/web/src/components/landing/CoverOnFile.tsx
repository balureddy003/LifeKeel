import { Lantern } from './Lantern'
import { InlineCta } from './InlineCta'
import './hero.css'
import './bands.css'

const ROWS: { cover: string; onFile: string; note: React.ReactNode }[] = [
  {
    cover: 'Life',
    onFile: '£180,000, renews 3 March',
    note: 'Below a rough estimate for this household.',
  },
  {
    cover: 'Income protection',
    onFile: 'Not on file',
    note: 'Worth raising with a licensed professional.',
  },
  {
    cover: 'Home',
    onFile: 'Renews in 45 days',
    note: 'Renewal terms are with the existing provider.',
  },
  {
    cover: 'Life, second policy',
    onFile: 'Same person, same type',
    note: 'Two policies of one type are on file. Keel cannot say if that is intended.',
  },
  {
    cover: 'Home contents',
    onFile: "Two policies, one in each partner's name",
    note: (
      <>
        Some policies cover the whole household, so this may be intended. Keel cannot say.{' '}
        <span className="lk-tag">Planned check</span>
      </>
    ),
  },
]

/** Before: a made-up cover-on-file table. Information from what is entered; no insurer named, nothing recommended. */
export function CoverOnFile() {
  return (
    <section className="lk-band" id="cover" aria-labelledby="lk-cover-h">
      <div className="lk-two">
        <div>
          <p className="lk-eyebrow">Before: cover on file</p>
          <h2 id="lk-cover-h">See what you hold, and where it looks light.</h2>
          <p className="lk-intro">
            Keel lists the policies you have told it about, when each renews, and where cover on
            file looks light against a rough estimate for your household. Estimates, not advice. It
            names no insurer and recommends no policy.
          </p>
          <p className="lk-intro">
            Keel Plus can read provider, policy number and renewal date from an uploaded policy for
            you to confirm. Typing them in is free.
          </p>
          <InlineCta location="cover" text="See your own cover on file." />
        </div>
        <article className="lk-cardx" aria-label="Sample cover on file">
          <header>
            <h3>Cover on file</h3>
            <span className="lk-tag">Sample household</span>
          </header>
          <div className="lk-lanterns" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <Lantern key={i} className={i >= 7 ? 'lk-ln-note' : 'lk-ln-ok'} />
            ))}
          </div>
          <p className="lk-fine">6 of 9 items on file. Keel only checks what is on file.</p>
          <div className="lk-scroll" role="region" aria-label="Sample cover table, scrolls sideways on small screens" tabIndex={0}>
            <table className="lk-cov" role="table">
              <thead>
                <tr role="row">
                  <th scope="col" role="columnheader">Cover</th>
                  <th scope="col" role="columnheader">On file</th>
                  <th scope="col" role="columnheader">Note</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.cover} role="row">
                    <th scope="row" role="rowheader">{r.cover}</th>
                    <td role="cell">{r.onFile}</td>
                    <td role="cell">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lk-est">
            Estimate: £180,000 on file against about £420,000 of rough household need. Gap about
            £240,000. Informational estimate only.
          </p>
          <p className="lk-fine">
            Made-up figures. Real figures come only from what you tell Keel.
          </p>
        </article>
      </div>
    </section>
  )
}
