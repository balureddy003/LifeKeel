import type { ObligationInput } from '@/lib/api'

export type MapFormValues = Record<string, string>

/** Client-side checks so the row's problem is named beside the field. */
export function validateMapForm(f: MapFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const blank = (k: string) => (f[k] ?? '').trim() === ''
  if (blank('label')) errors['label'] = 'Name the bill, policy or account'
  if (blank('named_person')) errors['named_person'] = 'Name who this depends on'
  if (blank('next_due_date')) errors['next_due_date'] = 'Choose the next due date'
  else if (Number.isNaN(Date.parse(f['next_due_date']!)))
    errors['next_due_date'] = 'Enter a real date'
  return errors
}

/** Turn the form's strings into the API's payload; optional blanks dropped. */
export function buildObligationInput(f: MapFormValues): ObligationInput {
  const out: ObligationInput = {
    label: f['label']!.trim(),
    named_person: f['named_person']!.trim(),
    next_due_date: f['next_due_date']!,
  }
  for (const k of [
    'category',
    'pays_from',
    'notices_to',
    'recurrence',
    'if_unavailable',
  ] as const) {
    const v = f[k]?.trim()
    if (v) out[k] = v
  }
  return out
}

/** Group rows by the person they depend on, keeping entry order. */
export function groupByPerson<T extends { named_person: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const key = r.named_person.trim() || 'Unassigned'
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return groups
}
