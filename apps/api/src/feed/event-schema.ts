/**
 * ReadinessEventSchema — the persisted shape of a `readiness_events` doc
 * (PRD-136 §1). emitReadinessEvent safeParses every event against this
 * before writing so a malformed event logs and is skipped rather than
 * landing a half-shaped document in the feed.
 */
import { z } from 'zod'

export const READINESS_EVENT_TYPES = [
  'score_moved',
  'insight_opened',
  'insight_repeated',
  'insight_resolved',
  'action_attributed',
  'scenario_moved',
  'renewal_approaching',
  'document_processed',
  'profile_changed',
  'playbook_steps_pending',
  'milestone',
  'sweep_quiet',
] as const

export type ReadinessEventType = (typeof READINESS_EVENT_TYPES)[number]

export const ReadinessEventSchema = z.object({
  type: z.enum(READINESS_EVENT_TYPES),
  severity: z.enum(['info', 'notice', 'attention', 'critical']),
  direction: z.enum(['up', 'down', 'flat']).nullable(),
  member_id: z.string().nullable(),
  domain: z.string().nullable(),
  title: z.string().min(1),
  summary: z.string().max(280),
  evidence: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().optional(),
        value_minor: z.number().optional(),
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        kind: z.enum(['insight', 'component', 'document', 'scenario', 'member', 'profile_field']),
        id: z.string(),
      }),
    )
    .default([]),
  next_check_at: z.date().nullable(),
  dedupe_key: z.string().min(1),
  feedback: z
    .array(
      z.object({
        user_id: z.string(),
        value: z.enum(['useful', 'not_relevant', 'handled', 'remind_later', 'data_wrong']),
        at: z.date(),
      }),
    )
    .optional(),
})

export type ReadinessEventInput = z.infer<typeof ReadinessEventSchema>
