import type { BriefCatalogueEntry } from '@/lib/api'
import type { FormValues } from './brief-form'

/**
 * PRD-230 friction budget — what gets measured on the first-value path.
 * Everything here is counts, timings and booleans derived from form state;
 * never a figure, name or date the household typed. The API refuses any
 * property outside this shape (growth-events.ts), and the allow-list test
 * in __tests__/ keeps the two sides from drifting.
 */
export interface BriefFrictionMeta extends Record<string, unknown> {
  problem_type: string
  ms_since_form_start?: number
  fields_entered?: number
  steps_seen?: number
  needed_account: boolean
  needed_connection: boolean
  needed_upload: boolean
}

/**
 * What the first number needs beyond the fields themselves. Today: nothing
 * — no account, connection or upload stands between the form and the first
 * number. Kept as a function of the entry so a future feature that changes
 * that has exactly one honest place to say so (and tests to update).
 */
export function firstValueRequirements(_entry: BriefCatalogueEntry): {
  needed_account: boolean
  needed_connection: boolean
  needed_upload: boolean
} {
  return { needed_account: false, needed_connection: false, needed_upload: false }
}

/**
 * Count of fields holding a value — the "fields asked before the number"
 * side of the budget. `steps_n` is bookkeeping (the extra-row counter), not
 * a field the household filled in.
 */
export function enteredFieldCount(f: FormValues): number {
  return Object.entries(f).filter(([k, v]) => k !== 'steps_n' && v.trim() !== '').length
}

/** brief_form_started — first focus in the form. */
export function formStartedMeta(entry: BriefCatalogueEntry, f: FormValues): BriefFrictionMeta {
  return {
    problem_type: entry.id,
    fields_entered: enteredFieldCount(f),
    ...firstValueRequirements(entry),
  }
}

/**
 * brief_first_number_shown — first time the live answer is on screen.
 * `ms_since_form_start` is omitted rather than invented when the form was
 * never focused (a fully prefilled update needs no first field tap).
 */
export function firstNumberMeta(
  entry: BriefCatalogueEntry,
  f: FormValues,
  stepsSeen: number,
  formStartedAt: number | null,
  now: number,
): BriefFrictionMeta {
  return {
    problem_type: entry.id,
    ...(formStartedAt === null
      ? {}
      : { ms_since_form_start: Math.max(0, Math.round(now - formStartedAt)) }),
    fields_entered: enteredFieldCount(f),
    steps_seen: stepsSeen,
    ...firstValueRequirements(entry),
  }
}
