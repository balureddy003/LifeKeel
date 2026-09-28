/**
 * Member agent loop (PRD-127) — the scheduled half of the member
 * micro-agent.
 *
 * Once a day, for every roster member of every family, rebuild the member
 * twin and reconcile the agent's nudges into `member_nudges`. This is what
 * makes the agent *proactive* rather than a page-view render: gaps are
 * discovered and nudges recorded even when nobody opens the member page,
 * and nudges whose evidence disappears resolve themselves.
 *
 * Safety properties:
 *  - Deterministic: no LLM. The nudges are whatever buildMemberAgent
 *    derives from the twin — a write-through of the same read model the
 *    member page renders.
 *  - Deduped: dedupe_key (member + kind + subject) is unique; re-runs
 *    refresh last_seen_at rather than duplicating.
 *  - Self-healing: open nudges the agent no longer produces are marked
 *    resolved on every pass.
 *  - No delivery: the loop only writes state — nothing is pushed to the
 *    family. Notification delivery, if wanted, is a separate trust-tier
 *    decision (see ARCHITECTURE.md).
 *
 * Scheduled daily from server.ts under the 'member-agent-loop' cron lock.
 */

import type { Db } from 'mongodb'
import { createLogger } from '@agentoak/platform'
import { getFamilyGroupsCollection } from '../db.js'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import { getMemberTwin, buildMemberAgent } from '../routes/member-twin.js'
import { reconcileMemberNudges } from '../member-nudges.js'

const log = createLogger({ service: 'member-agent-loop', version: '0.0.0' })

export interface MemberAgentLoopSummary {
  families: number
  members: number
  failed: number
}

export async function runMemberAgentLoop(db: Db, opts: { now?: Date } = {}): Promise<MemberAgentLoopSummary> {
  const now = opts.now ?? new Date()
  const summary: MemberAgentLoopSummary = { families: 0, members: 0, failed: 0 }

  const groups = (await getFamilyGroupsCollection(db).find({}).toArray()) as unknown as FamilyGroupDoc[]

  for (const group of groups) {
    summary.families++
    // Estate detail in the twin is viewer-gated — the loop acts with the
    // organizer's standing since the nudges it writes are read by adults
    // on the member page. A family with no organizer skips estate detail
    // rather than widening visibility.
    const organizer = group.members.find((m) => m.role === 'organizer')
    const viewerId = organizer?.user_id ?? organizer?.id ?? ''

    for (const member of group.members) {
      try {
        const twin = await getMemberTwin(db, group.tenant_id, member.id, viewerId)
        if (!twin) continue
        await reconcileMemberNudges(db, group.tenant_id, buildMemberAgent(twin), now)
        summary.members++
      } catch (err) {
        summary.failed++
        log.error({ err, tenant_id: group.tenant_id, member_id: member.id }, 'Member agent pass failed')
      }
    }
  }

  return summary
}
