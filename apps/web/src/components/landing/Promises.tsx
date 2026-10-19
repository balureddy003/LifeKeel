import './hero.css'
import './bands.css'

/** Each promise names the claim in claims.ts that backs it. */
export const PROMISES: { claim: string; title: string; body: string }[] = [
  {
    claim: 'no-commissions',
    title: 'No commissions',
    body: 'Keel earns from subscriptions only. It takes no commissions from providers and shows no ads.',
  },
  {
    claim: 'no-policy-picks',
    title: 'No policy picks',
    body: 'Keel names no insurer and ranks no policy. For any decision it points you to a licensed professional.',
  },
  {
    claim: 'no-policy-picks',
    title: 'No switching advice',
    body: 'Keel does not judge what you pay or point you to a different policy. It shows what you hold and when it renews.',
  },
  {
    claim: 'draft-insurer',
    title: 'No claims made for you',
    body: 'Keel finds the policy and the contact, and drafts a message. You make the claim.',
  },
  {
    claim: 'no-selling',
    title: 'No selling your data',
    body: 'Your details are never sold. The processors we use are listed in the privacy notice.',
  },
  {
    claim: 'approval-first',
    title: 'No quiet actions',
    body: 'Keel prepares drafts and you send them. The few things it sends for you, such as emails to people you name if you go quiet, stay off until you switch them on.',
  },
]

export function Promises() {
  return (
    <section className="lk-band" id="promises" aria-labelledby="lk-promises-h">
      <p className="lk-eyebrow">Six promises</p>
      <h2 id="lk-promises-h">Six things Keel does not do.</h2>
      <ul className="lk-ledger">
        {PROMISES.map((p) => (
          <li key={p.title}>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
