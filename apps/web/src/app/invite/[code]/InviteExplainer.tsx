import { Check } from 'lucide-react'
import { INVITE_ASK, INVITE_PROMISES, INVITE_WHAT } from './invite-copy'

/**
 * For the adult who got the invite. Says what LifeKeel is and what they are asked to do, and
 * repeats the promises. It never shows anything from the list or a family name: the link can reach
 * the wrong person. Claims: family-list, every-adult-confirms, no-commissions, no-money-moved,
 * no-selling.
 */
export function InviteExplainer() {
  return (
    <section aria-label="About LifeKeel" className="mb-6 rounded-2xl border border-haze p-4">
      <p className="text-sm text-ink-primary leading-relaxed">{INVITE_WHAT}</p>
      <p className="text-sm text-ink-secondary leading-relaxed mt-2">{INVITE_ASK}</p>
      <ul className="mt-3 space-y-1.5">
        {INVITE_PROMISES.map((p) => (
          <li key={p} className="flex items-center gap-2 text-sm text-ink-primary">
            <Check size={14} className="text-family-400 shrink-0" aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
    </section>
  )
}
