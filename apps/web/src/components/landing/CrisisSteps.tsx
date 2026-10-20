import './hero.css'
import './bands.css'

const ROWS = [
  {
    tag: 'Papers',
    lead: 'Documents in one place.',
    body: "Wills, powers of attorney and policy papers your family's adults can open. Sealing a file with a passphrase is optional. If you choose it, there is no recovery, so keep the passphrase safe.",
  },
  {
    tag: 'Steps',
    lead: 'What to do first.',
    body: 'Tell Keel what happened: job loss, bereavement, illness, disability, a car accident, home damage or travel trouble. It lists the steps in order, with the policies and contacts you have on file filled in.',
  },
  {
    tag: 'Who to call',
    lead: 'The contact, and a draft.',
    body: 'Keel shows the claims contact printed in your policy papers and drafts a message with your policy details. You read it, edit it and send it yourself.',
  },
  {
    tag: 'If you are away',
    lead: 'People who are told.',
    body: 'If you choose, Keel emails family adults you name when you have been quiet for a while, pointing them to papers they can already open.',
  },
]

const STEPS = [
  {
    tag: 'Find',
    text: 'Life policy on file. The claims contact from the policy papers is shown here.',
  },
  { tag: 'Notify', text: 'A draft message to the provider, for you to edit and send.' },
  { tag: 'Gather', text: 'Will and power of attorney on file, and where the originals are kept.' },
  {
    tag: 'Ask',
    text: 'Questions for a licensed professional about anything involving a lump sum.',
  },
]

/** During and after: what exists for a family when something happens, with one sample set of steps. */
export function CrisisSteps() {
  return (
    <section className="lk-band" id="crisis" aria-labelledby="lk-crisis-h">
      <div className="lk-two">
        <div>
          <p className="lk-eyebrow">During and after: when something happens</p>
          <h2 id="lk-crisis-h">When something happens, your family has somewhere to start.</h2>
          <p className="lk-intro">
            Access is for adults who have joined your family on LifeKeel. Nothing is released to
            anyone else.
          </p>
          <ul className="lk-rows">
            {ROWS.map((r) => (
              <li key={r.tag}>
                <b>{r.tag}</b>
                <p>
                  <strong>{r.lead}</strong>
                  {r.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <article className="lk-cardx" aria-label="Sample steps">
          <header>
            <h3>If a partner dies</h3>
            <span className="lk-tag">Sample</span>
          </header>
          <ol className="lk-pb">
            {STEPS.map((s) => (
              <li key={s.tag}>
                <b>{s.tag}</b>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="lk-fine">
            Sample steps for a made-up household. Keel only lists what you have told it.
          </p>
        </article>
      </div>
    </section>
  )
}
