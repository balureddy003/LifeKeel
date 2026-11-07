import type { RecordType } from './types.js'

const MONEY = /^\d{1,10}(\.\d{1,2})?$/

/**
 * Checks a household-entered record against its pack definition. Returns a
 * plain-language problem, or null when it is fine. Blank values are dropped by
 * the caller, so only filled-in values are checked here.
 */
export function checkRecordValues(
  rec: RecordType,
  values: Record<string, string>,
  rosterIds: ReadonlySet<string>,
  holder: string | null | undefined,
  covers: string | null | undefined,
): string | null {
  for (const id of [holder, covers])
    if (id && !rosterIds.has(id)) return 'Choose a person in the family'
  for (const f of rec.fields) {
    const v = values[f.key]
    if (v === undefined || v === '') continue
    if (f.kind === 'choice' && !f.choices?.includes(v))
      return `Choose one of the options for ${f.label}`
    if (f.kind === 'member' && !rosterIds.has(v))
      return `Choose a person in the family for ${f.label}`
    if (f.kind === 'date') {
      const ok =
        /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)
      if (!ok) return `Enter ${f.label} as a real date`
    }
    if (f.kind === 'money' && !MONEY.test(v)) return `Enter ${f.label} as an amount`
  }
  return null
}
