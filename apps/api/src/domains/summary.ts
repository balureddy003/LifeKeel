import type { Db } from 'mongodb'
import { DOMAINS } from './registry.js'
import type { DomainPack } from './types.js'
import { buildDomainView } from './view.js'

export interface DomainDigestLine {
  title: string
  records: number
  /** True when every required adult has confirmed the current version. */
  seen_by_all: boolean
  /** The soonest date that prompts a re-check, if one is due or close. */
  next: { label: string; date: string } | null
}

/**
 * One factual line per domain that has anything on file, for the monthly
 * digest: how many records, whether every adult has seen the current version,
 * and the soonest prompt date. Counts and dates only: no names, no amounts, no
 * judgement. A domain with nothing on file is left out rather than nagged.
 */
export async function summariseDomains(
  db: Db,
  tenantId: string,
  now: Date,
  packs: readonly DomainPack[] = DOMAINS,
): Promise<DomainDigestLine[]> {
  const lines: DomainDigestLine[] = []
  for (const pack of packs) {
    const view = await buildDomainView(db, tenantId, pack, undefined, now)
    if (view.rows.length === 0) continue
    const next = view.upcoming.find((u) => u.days >= 0) ?? view.upcoming[0]
    lines.push({
      title: pack.title,
      records: view.rows.length,
      seen_by_all: view.confirmation.both_confirmed,
      next: next ? { label: next.label, date: next.date } : null,
    })
  }
  return lines
}
