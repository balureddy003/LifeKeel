import type { EmployerCoverFact } from '@/lib/api'

/** The recorded_cover line composed from cover facts on file (PRD-232). */
export function composeRecordedCover(facts: EmployerCoverFact[]): string {
  return facts
    .filter((f) => f.confirmed)
    .map((f) => {
      const bits = [f.name_as_printed]
      if (f.source) bits.push(`(${f.source}${f.last_seen_at ? `, seen ${f.last_seen_at}` : ''})`)
      if (f.ends_with_employment) bits.push('— may end with the employment')
      return `${f.member_label}: ${bits.join(' ')}`
    })
    .join('; ')
}

/** True when any confirmed fact says it ends with the employment. */
export const anyEndsWithEmployment = (facts: EmployerCoverFact[]) =>
  facts.some((f) => f.confirmed && f.ends_with_employment)

/** Briefs that take employer cover: job-change family (stop/mixed modes). */
export const takesEmployerCover = (mode: string) => mode === 'stop' || mode === 'mixed'
