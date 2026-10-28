/**
 * Household setup presets. These describe how to configure LifeKeel for a
 * household shape — never a financial product. Only notification settings
 * the organizer can already change are proposable; everything else is
 * guidance with a link. Automation settings (Tier 3 opt-ins) are never
 * proposed. Covered by advice-rule.test.ts.
 */
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { KeelContext } from './context.js'
import { projectionFor } from './field-classes.js'
import type { StepId } from './setup-state.js'

export const PROPOSABLE_SETTINGS = ['digest_mode', 'heartbeat_cadence', 'min_urgency'] as const
export type ProposableKey = (typeof PROPOSABLE_SETTINGS)[number]

export type ProposableValue =
  boolean | 'weekly' | 'monthly' | 'off' | 'critical' | 'high' | 'medium' | 'low'

/** Same defaults as GET /family/notifications applies when nothing is saved. */
export const NOTIFICATION_DEFAULTS: Record<ProposableKey, ProposableValue> = {
  digest_mode: false,
  heartbeat_cadence: 'monthly',
  min_urgency: 'low',
}

export interface Preset {
  id: string
  match: { adults: number; children: number }
  title: string
  rationale: string
  setup_order: StepId[]
  proposable: Record<ProposableKey, ProposableValue>
  guidance: string[]
}

const COMMON_GUIDANCE = [
  'Channels: only turn on a channel you have already set up and agreed to receive messages on.',
  'Quiet hours: pick hours that suit the household once you are ready; Keel does not suggest local times yet.',
  'Automation: renewal reminders and automatic runs are off by default and stay off unless the household chooses them on the Automation screen.',
  'Two-step sign-in: each adult turns it on in Settings under Security.',
]

export const PRESETS: Preset[] = [
  {
    id: 'two_adults_two_children',
    match: { adults: 2, children: 2 },
    title: 'A starting setup for two adults and two children',
    rationale:
      'A common starting point for a household of four. Each setting can be changed later in Settings.',
    setup_order: [
      'household_created',
      'partner_invited',
      'children_added',
      'income_recorded',
      'expenses_recorded',
      'emergency_fund_recorded',
      'protection_on_file',
      'education_goals',
      'documents_uploaded',
      'notifications_configured',
      'mfa_enabled',
      'emergency_contacts',
    ],
    proposable: { digest_mode: true, heartbeat_cadence: 'monthly', min_urgency: 'medium' },
    guidance: [
      'Invite the other adult so their income and cover are confirmed by them, not entered on their behalf.',
      "Add each child's date of birth so age-based checks, such as education goals, can run.",
      'Record the cover already on file for each adult. Keel shows possible gaps for information only; a licensed professional can help with decisions.',
      'Name emergency contacts and guardians in the legacy register.',
      ...COMMON_GUIDANCE,
    ],
  },
  {
    id: 'household_default',
    match: { adults: 0, children: 0 },
    title: 'A starting setup for your household',
    rationale: 'A simple starting point. Each setting can be changed later in Settings.',
    setup_order: [
      'household_created',
      'partner_invited',
      'children_added',
      'income_recorded',
      'expenses_recorded',
      'emergency_fund_recorded',
      'protection_on_file',
      'education_goals',
      'documents_uploaded',
      'notifications_configured',
      'mfa_enabled',
      'emergency_contacts',
    ],
    proposable: { digest_mode: true, heartbeat_cadence: 'monthly', min_urgency: 'medium' },
    guidance: [
      'Add everyone in the household on the Family screen; each adult confirms their own details.',
      'Record the cover already on file for each adult.',
      ...COMMON_GUIDANCE,
    ],
  },
]

/** Exact (adults, children) match, then the default. Uses the saved roster only. */
export function pickPreset(adults: number, children: number): Preset {
  return (
    PRESETS.find((p) => p.match.adults === adults && p.match.children === children) ??
    PRESETS.find((p) => p.id === 'household_default')!
  )
}

export interface SettingChange {
  key: ProposableKey
  from: ProposableValue
  to: ProposableValue
}

export async function currentNotificationSettings(
  db: Db,
  ctx: KeelContext,
): Promise<Record<ProposableKey, ProposableValue>> {
  const doc = (await getTenantCollection(db, 'delivery_preferences', ctx.tenant_id).findOne(
    {},
    { projection: projectionFor('delivery_preferences') },
  )) as Partial<Record<ProposableKey, ProposableValue>> | null
  return {
    digest_mode: doc?.digest_mode ?? NOTIFICATION_DEFAULTS.digest_mode,
    heartbeat_cadence: doc?.heartbeat_cadence ?? NOTIFICATION_DEFAULTS.heartbeat_cadence,
    min_urgency: doc?.min_urgency ?? NOTIFICATION_DEFAULTS.min_urgency,
  }
}

export function diffSettings(
  current: Record<ProposableKey, ProposableValue>,
  target: Record<ProposableKey, ProposableValue>,
): SettingChange[] {
  return PROPOSABLE_SETTINGS.filter((k) => current[k] !== target[k]).map((key) => ({
    key,
    from: current[key],
    to: target[key],
  }))
}
