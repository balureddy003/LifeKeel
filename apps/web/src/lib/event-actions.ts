/**
 * Event checklist data + persistence helpers, shared between the event
 * detail page and CrisisMode. Lives in lib/ (not a page file) so importing
 * it doesn't pull an entire page component into another page's bundle.
 */
import type { FinancialProfilePolicy, PolicyType } from './api'

export interface Action {
  id: string
  label: string
  done: boolean
  // KEEL-014: when set, and a policy of one of these types exists on the
  // household's financial profile, personalize() replaces the generic
  // label with one naming the real provider — otherwise the generic label
  // (above) renders unchanged.
  policyTypes?: PolicyType[]
  personalize?: (provider: string) => string
}

export const EVENT_ACTIONS: Record<string, Action[]> = {
  bereavement: [
    {
      id: '1',
      label: 'Call your life insurance provider to start a claim',
      done: false,
      policyTypes: ['life'],
      personalize: (provider) => `Call ${provider} about your life insurance claim`,
    },
    { id: '2', label: 'Contact employer for survivor benefits', done: false },
    { id: '3', label: 'Notify pension provider for survivor pension', done: false },
    { id: '4', label: 'Check whether your mortgage has protection cover', done: false },
    { id: '5', label: 'Schedule a meeting with a financial advisor', done: false },
  ],
  medical: [
    {
      id: '1',
      label: 'Review your health insurance coverage details',
      done: false,
      policyTypes: ['health', 'critical_illness'],
      personalize: (provider) => `Review your ${provider} coverage details`,
    },
    { id: '2', label: 'Check if pre-authorization is needed for treatment', done: false },
    { id: '3', label: 'Confirm your annual out-of-pocket maximum', done: false },
    { id: '4', label: 'Check your HSA balance for eligible expenses', done: false },
  ],
  'job-loss': [
    { id: '1', label: 'Review how many months your emergency savings cover', done: false },
    { id: '2', label: 'Check if you have income protection insurance', done: false },
    { id: '3', label: 'Review budget and cut non-essential spending', done: false },
    { id: '4', label: 'Update resume and start job search', done: false },
    { id: '5', label: 'Check eligibility for unemployment benefits', done: false },
  ],
  retirement: [
    { id: '1', label: 'Review your pension progress toward your target', done: false },
    { id: '2', label: 'See whether increasing monthly contributions helps', done: false },
    { id: '3', label: 'Confirm your employer match is fully utilized', done: false },
    { id: '4', label: 'Check your state pension forecast', done: false },
    { id: '5', label: 'Schedule a retirement planning review', done: false },
  ],
  default: [
    { id: '1', label: 'Review your insurance coverage', done: false },
    { id: '2', label: 'Check emergency savings', done: false },
    { id: '3', label: 'Contact your financial advisor', done: false },
  ],
}

// Checklist completion has no backend endpoint — persist client-side so
// "your family's response plan" doesn't forget your progress on reload.
// Scoped by tenant so a shared device doesn't leak one user's checklist
// state into another's, and by event so action ids (which repeat across
// events, e.g. '1'-'5') don't bleed into each other.
function checklistStorageKey(eventId: string): string {
  const tenant =
    typeof window !== 'undefined' ? (localStorage.getItem('lifekeel_tenant') ?? 'anon') : 'anon'
  return `lifekeel:event-checklist:${tenant}:${eventId}`
}

export function loadDoneIds(eventId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(checklistStorageKey(eventId))
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

export function saveDoneIds(eventId: string, doneIds: Set<string>): void {
  try {
    localStorage.setItem(checklistStorageKey(eventId), JSON.stringify([...doneIds]))
  } catch {
    // Best-effort — private browsing / storage-full shouldn't break the checklist.
  }
}

// KEEL-014: the checklist used to be 100% generic strings even when the
// family had already told Keel who their real provider is — this swaps in
// that real name wherever a matching policy exists, leaving the generic
// text alone otherwise.
export function personalizeAction(action: Action, policies: FinancialProfilePolicy[]): string {
  if (!action.policyTypes || !action.personalize) return action.label
  const match = policies.find((p) => action.policyTypes!.includes(p.type))
  return match ? action.personalize(match.provider) : action.label
}
