import { GlassCard } from '@/components/Glass'
import type { DomainView } from '@/lib/api'
import { cellText, noPolicyText } from './domain-copy'

type Matrix = NonNullable<DomainView['matrix']>

const UNMATCHED = 'Not matched to anyone yet'

/**
 * "Who is covered by what" as grouped lists: one group per person, each policy with how it relates
 * to them. It replaces a table that needed to scroll sideways on a phone. A policy nobody is matched
 * to has its own group instead of disappearing. States facts only; it never says what is enough.
 */
export function CoverageList({ matrix }: { matrix: Matrix }) {
  const unmatched = matrix.rows.filter((r) => matrix.columns.every((c) => !r.cells[c.id]))

  return (
    <section aria-label={matrix.label} className="mt-6 space-y-3">
      {matrix.columns.map((person) => {
        const rows = matrix.rows.filter((r) => r.cells[person.id])
        return (
          <GlassCard key={person.id} className="p-4">
            <div role="group" aria-label={person.name}>
              <h3 className="text-base font-semibold text-ink-primary">{person.name}</h3>
              {rows.length === 0 ? (
                <p className="mt-1 text-sm text-ink-secondary">{noPolicyText(person.name)}</p>
              ) : (
                <ul className="mt-2 divide-y divide-haze">
                  {rows.map((r) => (
                    <li key={r.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="text-base text-ink-primary">{r.label}</div>
                      <div className="text-sm text-ink-secondary">
                        {cellText(r.cells[person.id] ?? null)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </GlassCard>
        )
      })}
      {unmatched.length > 0 && (
        <GlassCard className="p-4">
          <div role="group" aria-label={UNMATCHED}>
            <h3 className="text-base font-semibold text-ink-primary">{UNMATCHED}</h3>
            <ul className="mt-2 divide-y divide-haze">
              {unmatched.map((r) => (
                <li key={r.id} className="py-2 text-base text-ink-primary first:pt-0 last:pb-0">
                  {r.label}
                </li>
              ))}
            </ul>
          </div>
        </GlassCard>
      )}
    </section>
  )
}
