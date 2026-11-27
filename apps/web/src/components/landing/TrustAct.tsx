/**
 * Scroll 5 — the trust act.
 *
 * The audience's last chance to lose trust, so it is the simplest and most
 * literal section on the page: a short ledger of promises, one per line, each
 * with an italic gloss beneath it. Every line is anchored to a `live` row in
 * claims.ts — nothing here is invented, and the test fails if a row stops
 * being live.
 *
 * What is deliberately absent (see the brief, Scroll 5): the claim 'family
 * data is never used for training' (claims.ts `no-training`, blocked) and any
 * 'always on / 24/7' promise (`always-on`, blocked). No trust score, no
 * security badge, no customer-count. Restraint is the whole argument.
 *
 * See docs/marketing/cinematic-site-redesign-2026-11-26.md §4 / Scroll 5.
 */

export interface TrustPromise {
  /** The promise, as a short sentence. */
  promise: string
  /** Plain-language gloss: what it means in practice. */
  gloss: string
  claims: string[]
}

export const TRUST_PROMISES: TrustPromise[] = [
  {
    promise: 'Subscriptions only.',
    gloss: 'No commissions, no ads, no payouts to Keel when you act on a Keel insight.',
    claims: ['no-commissions'],
  },
  {
    promise: 'Never moves money.',
    gloss: 'A draft message is drafted, not sent. A claim packet is prepared, not filed.',
    claims: ['no-money-moved'],
  },
  {
    promise: 'Never gives advice.',
    gloss:
      'Keel names no insurer, ranks no policy and never tells you to switch. The list holds what is on file. The advice comes from a licensed professional, when you want one.',
    claims: ['no-policy-picks'],
  },
  {
    promise: 'Details not sold.',
    gloss:
      'What your family puts in is not sold and does not go to advertising networks. The AI providers listed on the Trust page process a request only to answer it.',
    claims: ['no-selling'],
  },
  {
    promise: 'Nothing acts for you without you turning it on.',
    gloss: 'A drafted message is yours to send. A planned action is yours to approve.',
    claims: ['approval-first'],
  },
  {
    promise: 'Any adult can leave.',
    gloss:
      'A person removed is cut off at once. You can export your data and delete your account from Settings.',
    claims: ['leave-and-removal', 'export-data', 'delete-account'],
  },
  {
    promise: 'Passwords encrypted before they are stored.',
    gloss: 'Connector passwords and access tokens are encrypted before they are stored.',
    claims: ['encrypted-at-rest'],
  },
  {
    // Carried over from the security cards this act replaces: a life-event draft
    // can be written on the device rather than sent to a model.
    promise: 'Drafts can stay on your device.',
    gloss:
      'Where the browser supports it, a life-event draft is written on your device, so those words never leave it.',
    claims: ['on-device-drafts'],
  },
]

export const TRUST_FOOTNOTE = 'Information-only. Never underwriting. Never advice.'

export function TrustAct() {
  return (
    <section className="vv-section lk-trust" id="security" aria-labelledby="lk-trust-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The promises</p>
        <h2 id="lk-trust-h">What we promise, in plain words.</h2>
      </header>

      <dl className="lk-trust-list">
        {TRUST_PROMISES.map((p) => (
          <div key={p.promise} className="lk-trust-row" data-claims={p.claims.join(' ')}>
            <dt>{p.promise}</dt>
            <dd>{p.gloss}</dd>
          </div>
        ))}
      </dl>

      <p className="lk-trust-foot">{TRUST_FOOTNOTE}</p>
    </section>
  )
}
