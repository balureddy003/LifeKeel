/**
 * Member-agent nudge persistence (PRD-127).
 *
 * The PRD-126 agent persona computes nudges fresh off the member twin —
 * a pure read model with no memory. This module gives the agent loop its
 * state: each nudge is persisted in `member_nudges` keyed by a stable
 * dedupe_key, so the same gap doesn't re-announce itself on every view,
 * a dismissed nudge stays dismissed while its evidence stands, and a
 * nudge whose evidence disappears resolves itself on the next reconcile.
 *
 * Reconcile semantics (shared by the GET route and the daily cron loop):
 *   - produced nudge, no row        → insert, status 'open'
 *   - produced nudge, status open   → refresh detail + last_seen_at
 *   - produced nudge, dismissed     → refresh detail + last_seen_at,
 *                                     stays dismissed (intent respected
 *                                     while the same evidence stands)
 *   - produced nudge, resolved      → reopened (the gap returned after
 *                                     being fixed — a new occurrence)
 *   - open row not produced         → status 'resolved'
 */

import type { Db } from 'mongodb'
import { createHash, randomUUID } from 'node:crypto'
import { getMemberNudgesCollection } from './db.js'
import type { MemberAgentNudge, MemberAgentResult } from './routes/member-twin.js'

export interface MemberNudgeDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  member_id: string
  dedupe_key: string
  kind: MemberAgentNudge['kind']
  title: string
  detail: string
  source?: MemberAgentNudge['source']
  persona: MemberAgentResult['persona']
  status: 'open' | 'dismissed' | 'resolved'
  first_seen_at: Date
  last_seen_at: Date
  dismissed_at?: Date
  resolved_at?: Date
}

export async function ensureMemberNudgeIndexes(db: Db): Promise<void> {
  const col = getMemberNudgesCollection(db)
  await col.createIndex({ dedupe_key: 1 }, { unique: true }).catch(() => {})
  await col.createIndex({ tenant_id: 1, member_id: 1, status: 1 }).catch(() => {})
}

/**
 * What identifies a nudge across runs: the member, the kind, and the
 * thing it's about (readiness component or source insight). The wording
 * is deliberately NOT part of the key — copy tweaks shouldn't resurrect
 * dismissed nudges.
 */
export function nudgeDedupeKey(memberId: string, nudge: MemberAgentNudge): string {
  const subject = nudge.source?.insight_id ?? nudge.source?.component ?? nudge.title
  return createHash('sha256').update([memberId, nudge.kind, subject].join('|')).digest('hex')
}

/**
 * Persist the agent's current output for one member and return the nudges
 * that should be visible — open rows only, with their persisted id and
 * first_seen_at attached (dismissed and resolved rows are filtered out).
 */
export async function reconcileMemberNudges(
  db: Db,
  tenantId: string,
  agent: MemberAgentResult,
  now: Date = new Date(),
): Promise<Array<MemberAgentNudge & { id: string; first_seen_at: Date }>> {
  const col = getMemberNudgesCollection(db)
  const produced = new Set<string>()

  for (const nudge of agent.nudges) {
    const key = nudgeDedupeKey(agent.member.id, nudge)
    produced.add(key)
    const existing = await col.findOne({ dedupe_key: key }) as MemberNudgeDoc | null

    if (!existing) {
      await col.updateOne(
        { dedupe_key: key },
        {
          $setOnInsert: {
            id: randomUUID(),
            tenant_id: tenantId,
            member_id: agent.member.id,
            dedupe_key: key,
            kind: nudge.kind,
            title: nudge.title,
            detail: nudge.detail,
            source: nudge.source,
            persona: agent.persona,
            status: 'open',
            first_seen_at: now,
            last_seen_at: now,
          } satisfies Partial<MemberNudgeDoc>,
        },
        { upsert: true },
      )
      continue
    }

    // Dismissed nudges keep their status while the evidence stands —
    // detail refreshes so the row stays truthful if un-dismissed later.
    if (existing.status === 'dismissed') {
      await col.updateOne(
        { dedupe_key: key },
        { $set: { title: nudge.title, detail: nudge.detail, last_seen_at: now } },
      )
      continue
    }

    // Open stays open; resolved reopens (the gap came back — new
    // occurrence, so first_seen_at resets to reflect the fresh sighting).
    await col.updateOne(
      { dedupe_key: key },
      {
        $set: {
          title: nudge.title,
          detail: nudge.detail,
          status: 'open',
          last_seen_at: now,
          ...(existing.status === 'resolved' ? { first_seen_at: now } : {}),
        },
        $unset: { resolved_at: '' },
      },
    )
  }

  // Anything open that the agent no longer produces has resolved itself.
  await col.updateMany(
    { tenant_id: tenantId, member_id: agent.member.id, status: 'open', dedupe_key: { $nin: [...produced] } },
    { $set: { status: 'resolved', resolved_at: now, last_seen_at: now } },
  )

  const rows = (await col
    .find({ tenant_id: tenantId, member_id: agent.member.id, status: 'open' })
    .toArray()) as unknown as MemberNudgeDoc[]

  // Preserve the agent's own ordering — the persisted rows map back onto
  // the produced nudges by dedupe key; a produced nudge without a row can
  // only happen if its row is dismissed (correctly absent from the list).
  const byKey = new Map(rows.map((r) => [r.dedupe_key, r]))
  return agent.nudges.flatMap((nudge) => {
    const row = byKey.get(nudgeDedupeKey(agent.member.id, nudge))
    return row ? [{ ...nudge, id: row.id, first_seen_at: row.first_seen_at }] : []
  })
}

/**
 * Dismiss one persisted nudge — scoped to the member so one member's id
 * can't silence another's. Returns false when nothing was dismissed
 * (unknown id, wrong member, or already dismissed/resolved).
 */
export async function dismissMemberNudge(
  db: Db,
  tenantId: string,
  memberId: string,
  nudgeId: string,
): Promise<boolean> {
  const result = await getMemberNudgesCollection(db).updateOne(
    { id: nudgeId, tenant_id: tenantId, member_id: memberId, status: 'open' },
    { $set: { status: 'dismissed', dismissed_at: new Date() } },
  )
  return result.modifiedCount === 1
}
