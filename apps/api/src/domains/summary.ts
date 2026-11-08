import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import { DOMAINS } from './registry.js'
import type { DomainPack } from './types.js'
import { buildDomainView } from './view.js'

/** How many digests may say "not yet seen by every adult" for one version of a list. */
export const UNSEEN_MENTION_LIMIT = 2

type UnseenMentionDoc = {
  tenant_id: string
  domain_id: string
  result_version: string
  windows: string[]
}

export interface DomainDigestLine {
  domain_id: string
  /** Hash of the list as it stands: a change starts the reminder over. */
  result_version: string
  /** True once the "not yet seen" reminder has been given enough times. */
  quiet: boolean
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
  windowId?: string,
): Promise<DomainDigestLine[]> {
  const lines: DomainDigestLine[] = []
  const mentions = getTenantCollection<UnseenMentionDoc>(db, 'digest_unseen_mentions', tenantId)
  for (const pack of packs) {
    const view = await buildDomainView(db, tenantId, pack, undefined, now)
    if (view.rows.length === 0) continue
    const next = view.upcoming.find((u) => u.days >= 0) ?? view.upcoming[0]
    const seen = view.confirmation.both_confirmed
    // Earlier digests (not this window, so a retry is not a second mention) that
    // already told the family this version is not yet seen. After the limit the
    // line stays, minus the reminder: a monthly nag with no end is its own harm.
    const earlier = seen
      ? 0
      : (
          (
            await mentions.findOne({
              domain_id: pack.id,
              result_version: view.result_version,
            })
          )?.windows ?? []
        ).filter((w) => w !== windowId).length
    lines.push({
      domain_id: pack.id,
      result_version: view.result_version,
      quiet: !seen && earlier >= UNSEEN_MENTION_LIMIT,
      title: pack.title,
      records: view.rows.length,
      seen_by_all: seen,
      next: next ? { label: next.label, date: next.date } : null,
    })
  }
  return lines
}

/**
 * Note that this window's digest carried the "not yet seen" reminder. Call it
 * only after the digest was actually delivered. Idempotent per window.
 */
export async function recordUnseenMentions(
  db: Db,
  tenantId: string,
  lines: readonly DomainDigestLine[],
  windowId: string,
): Promise<void> {
  const mentions = getTenantCollection<UnseenMentionDoc>(db, 'digest_unseen_mentions', tenantId)
  for (const l of lines) {
    if (l.seen_by_all || l.quiet) continue
    await mentions.updateOne(
      { domain_id: l.domain_id, result_version: l.result_version },
      { $addToSet: { windows: windowId } },
      { upsert: true },
    )
  }
}
