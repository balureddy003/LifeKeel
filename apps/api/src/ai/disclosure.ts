/**
 * "Who processes your documents" (PRD-142 amendment 3): what the family can be
 * told, built from the two registries so it cannot drift from what the gateway
 * enforces. It states the review status as it is: a hosted processor whose
 * terms have not been reviewed is shown as not reviewed, never as approved.
 * Contract details (DPA date, breach SLA, terms reference) are not exposed.
 */
import type {
  AiTaskPolicy,
  ProcessorEntry,
  ProcessorRegistry,
  TaskRegistry,
} from '@lifekeel/platform'
import { NOT_REVIEWED } from '@lifekeel/platform'

export type ProcessorStatusLabel =
  'run_by_lifekeel' | 'terms_under_review' | 'approved' | 'review_overdue'

export type WhereItRuns = 'device' | 'lifekeel' | 'lifekeel_or_hosted' | 'hosted'

export interface AiDisclosure {
  generated_at: string
  processors: {
    id: string
    name: string
    hosting: 'self_hosted' | 'hosted'
    status: ProcessorStatusLabel
    /** null until a review has confirmed it. */
    region: string | null
    retention: string[]
    sub_processors: string[] | null
    review_due: string | null
    used_by_tasks: number
  }[]
  tasks: {
    task_id: string
    purpose: string
    where: WhereItRuns
    processors: string[]
    retention_class: string
  }[]
}

const whereFor = (p: AiTaskPolicy): WhereItRuns =>
  p.data_boundary === 'device_only'
    ? 'device'
    : p.data_boundary === 'lifekeel_infra_required'
      ? 'lifekeel'
      : // A lifekeel_infra task runs on our own model only while it is switched on.
        p.data_boundary === 'lifekeel_infra'
        ? 'lifekeel_or_hosted'
        : 'hosted'

function statusOf(e: ProcessorEntry, now: Date): ProcessorStatusLabel {
  if (e.status === 'self_hosted') return 'run_by_lifekeel'
  if (e.status === 'unreviewed') return 'terms_under_review'
  return Date.parse(e.review_due) < now.getTime() ? 'review_overdue' : 'approved'
}

const known = (v: string) => (v === NOT_REVIEWED ? null : v)

export function buildAiDisclosure(
  tasks: TaskRegistry,
  processors: ProcessorRegistry,
  now: Date = new Date(),
): AiDisclosure {
  const use = new Map<string, number>()
  for (const t of tasks.values())
    for (const id of t.allowed_processors ?? []) use.set(id, (use.get(id) ?? 0) + 1)
  return {
    generated_at: now.toISOString(),
    processors: [...processors.values()].map((e) => {
      const sub = e.sub_processors.filter((s) => s !== NOT_REVIEWED)
      return {
        id: e.id,
        name: e.name,
        hosting: e.hosting,
        status: statusOf(e, now),
        region: known(e.region),
        retention: [...new Set(Object.values(e.retention))],
        sub_processors: e.sub_processors.includes(NOT_REVIEWED) ? null : sub,
        review_due: e.status === 'approved' ? e.review_due : null,
        used_by_tasks: use.get(e.id) ?? 0,
      }
    }),
    tasks: [...tasks.values()].map((t) => ({
      task_id: t.task_id,
      purpose: t.purpose ?? t.task_id,
      where: whereFor(t),
      processors: t.allowed_processors ?? [],
      retention_class: t.provider_retention_class ?? 'unknown',
    })),
  }
}
