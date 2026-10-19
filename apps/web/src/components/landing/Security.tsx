import './landing.css'
import './hero.css'
import './bands.css'

export const SECURITY: { claim: string; title: string; body: string }[] = [
  {
    claim: 'encrypted-at-rest',
    title: 'Encrypted at rest',
    body: "Connector passwords and access tokens are encrypted before they're ever stored, not just in transit.",
  },
  {
    claim: 'no-selling',
    title: 'Never sold',
    body: "Your financial data isn't sold. Approved AI providers process it only for the request you make.",
  },
  {
    claim: 'delete-account',
    title: 'Yours to delete',
    body: 'Export your data or delete your account yourself from Settings. Deletion is immediate and cannot be undone.',
  },
]

export function Security() {
  return (
    <section className="lk-band" id="security" aria-labelledby="lk-security-h">
      <p className="lk-eyebrow">Security</p>
      <h2 id="lk-security-h">What we do with your data.</h2>
      <p className="lk-intro">Not a wall of badges, just what is true today.</p>
      <ul className="lk-trio">
        {SECURITY.map((s) => (
          <li key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
