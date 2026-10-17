/**
 * Insight → action attribution.
 *
 * The flywheel question is "did the family do anything after Keel flagged
 * this?" — an insight that keeps re-firing because nobody acts is noise;
 * one followed by a profile update, a policy added, or a document applied
 * is the loop working. This module records that association, not
 * causality: anything a family changes within 30 days of an insight
 * firing is logged as "associated with" it — correlation the product can
 * honestly show ("acted on"), never a claim that Keel caused the change.
 *
 * Storage is a tenant-scoped `insight_attribution` collection of
 * {insight_id, detector_id, rule_id, entity_key, action_type, action_at}
 * rows, deduped on (insight_id, action_type) — a second profile save for
 * the same insight refreshes action_at rather than growing a twin row.
 *
 * Tier 0 — bookkeeping only; nothing here notifies, executes, or infers.
 */

import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { Insight } from '@lifekeel/engine'
import { buildDedupeKey, emitReadinessEvent } from '../feed/emit.js'

export type InsightActionType =
  'profile_updated' | 'policy_added' | 'document_applied' | 'insight_approved' | 'step_completed'

export interface InsightAttributionDoc extends Record<string, unknown> {
  insight_id: string
  detector_id: string
  rule_id: string
  entity_key: string
  action_type: InsightActionType
  action_at: Date
  insight_created_at?: Date
}

/** Insights older than this aren't attributed — a profile edit a year
 *  after an insight fired is life, not a response to the flag. */
const ATTRIBUTION_WINDOW_MS = 30 * 86_400_000

const FAMILY_DETECTOR_PREFIX = 'family_'

const attributionCol = (db: Db, tenantId: string) =>
  getTenantCollection<InsightAttributionDoc>(db, 'insight_attribution', tenantId)

/**
 * Record a family action against every family-detector insight that fired
 * within the attribution window. Called from the small set of places an
 * action is unambiguous: the profile save route, the apply-to-profile
 * flow, insight approval, and playbook step completion.
 */
export async function recordInsightAction(
  db: Db,
  tenantId: string,
  actionType: InsightActionType,
  opts: { now?: Date; insightIds?: string[] } = {},
): Promise<number> {
  try {
    return await recordInsightActionInner(db, tenantId, actionType, opts)
  } catch {
    // Bookkeeping, not behavior — a store that can't answer the query
    // must never break the save/apply call that triggered it.
    return 0
  }
}

async function recordInsightActionInner(
  db: Db,
  tenantId: string,
  actionType: InsightActionType,
  opts: { now?: Date; insightIds?: string[] } = {},
): Promise<number> {
  const now = opts.now ?? new Date()
  const insightsCol = getTenantCollection<Insight>(db, 'insights', tenantId)
  const recent = (
    await insightsCol
      .find({
        detector_id: { $regex: `^${FAMILY_DETECTOR_PREFIX}` },
        created_at: { $gte: new Date(now.getTime() - ATTRIBUTION_WINDOW_MS) },
        // A targeted action (insight approved) credits just that insight;
        // ambient ones (profile saved, document applied) credit everything
        // flagged in the window.
        ...(opts.insightIds ? { id: { $in: opts.insightIds } } : {}),
      })
      .toArray()
  ).slice(0, 200)
  if (recent.length === 0) return 0

  const col = attributionCol(db, tenantId)
  await Promise.all(
    recent.map(
      (i: {
        id: string
        detector_id: string
        rule_id: string
        entity_key?: string
        created_at?: Date
        hypothesis?: string
      }) => {
        // PRD-136: the feed event goes alongside the attribution row — one
        // per (insight, action_type) pair, deduped the same way so a repeat
        // action refreshes rather than duplicates. Fire-and-forget like the
        // rest of this module.
        try {
          emitReadinessEvent(db, tenantId, {
            type: 'action_attributed',
            severity: 'notice',
            direction: 'up',
            member_id: null,
            domain: null,
            title: `You acted on: ${(i.hypothesis ?? i.rule_id?.replace(/_/g, ' ') ?? 'a flagged gap').slice(0, 80)}`,
            summary: 'Something on file changed within 30 days of this flag.',
            evidence: [],
            links: [{ kind: 'insight', id: i.id }],
            next_check_at: null,
            dedupe_key: buildDedupeKey('action_attributed', `${i.id}:${actionType}`),
          })
        } catch {
          // Feed narration must never take the attribution write down with it.
        }
        return col.updateOne(
          { insight_id: i.id, action_type: actionType },
          {
            $set: { action_at: now },
            $setOnInsert: {
              insight_id: i.id,
              detector_id: i.detector_id,
              rule_id: i.rule_id,
              entity_key: i.entity_key ?? '',
              action_type: actionType,
              insight_created_at: i.created_at,
            },
          },
          { upsert: true },
        )
      },
    ),
  )
  return recent.length
}

/**
 * Recent attributions for the read surface — newest first. The response
 * joins nothing insight-side on purpose: the caller needs insight ids to
 * mark "acted on" badges, and titles/severity come from the insights the
 * client already fetched.
 */
export async function listInsightAttributions(
  db: Db,
  tenantId: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<InsightAttributionDoc[]> {
  const sinceDays = opts.sinceDays ?? 90
  const since = new Date(Date.now() - sinceDays * 86_400_000)
  try {
    const rows = (await attributionCol(db, tenantId)
      .find({ action_at: { $gte: since } })
      .toArray()) as InsightAttributionDoc[]
    return rows
      .sort((a, b) => new Date(b.action_at).getTime() - new Date(a.action_at).getTime())
      .slice(0, opts.limit ?? 500)
  } catch {
    return []
  }
}
