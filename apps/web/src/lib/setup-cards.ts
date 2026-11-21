/**
 * Setup cards on a household's home, in the style of Apple Health's "Get more
 * from Health" stack: one card per job, one action each, and a dismiss that
 * is remembered. A finished or dismissed step is not shown.
 */
export interface SetupStep {
  id: string
  done: boolean
}

export const SETUP_DISMISSED_KEY = 'lifekeel-setup-dismissed'

export function visibleSetupSteps<T extends SetupStep>(steps: T[], dismissed: string[]): T[] {
  return steps.filter((s) => !s.done && !dismissed.includes(s.id))
}

export function readDismissed(storage: Pick<Storage, 'getItem'> | null): string[] {
  try {
    const raw = storage?.getItem(SETUP_DISMISSED_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function withDismissed(current: string[], id: string): string[] {
  return current.includes(id) ? current : [...current, id]
}
