/**
 * Field classification (design D10). Keel only ever loads fields listed
 * here; the loader builds its Mongo projections from this table, so an
 * untagged field is never read — it cannot reach evidence or a prompt.
 *
 *   own_private      only the user it belongs to
 *   household_shared active adults (viewers where existing pages show it)
 *   adult_only       active adults, never viewers or minors
 *   excluded         never through Keel (credentials, recovery codes,
 *                    connector tokens, raw document text) — listed so the
 *                    test can assert none of them is ever projected.
 */
export type FieldClass = 'own_private' | 'household_shared' | 'adult_only'

export const FIELD_CLASSES: Record<string, Record<string, FieldClass>> = {
  family_groups: {
    'members.id': 'household_shared',
    'members.user_id': 'household_shared',
    'members.role': 'household_shared',
    'members.status': 'household_shared',
    'members.date_of_birth': 'household_shared',
  },
  family_financial_profile: {
    'household.employment_status': 'household_shared',
    'household.monthly_salary_minor': 'household_shared',
    'household.annual_living_expenses_minor': 'household_shared',
    'household.life_cover_minor': 'household_shared',
    'emergency_fund.emergency_savings_minor': 'household_shared',
    'emergency_fund.monthly_expenses_minor': 'household_shared',
    'policies.type': 'household_shared',
    'policies.member_id': 'household_shared',
    'education_funds.member_id': 'household_shared',
    'education_funds.child_name': 'household_shared',
    updated_at: 'household_shared',
  },
  delivery_preferences: {
    reviewed_at: 'adult_only',
    digest_mode: 'adult_only',
    heartbeat_cadence: 'adult_only',
    min_urgency: 'adult_only',
  },
  users: {
    mfa_enabled: 'own_private',
  },
}

/** Fields that must never be projected by any Keel reader. */
export const EXCLUDED_FIELDS = [
  'mfa_recovery_hashes',
  'mfa_secret',
  'password_hash',
  'connector_credentials',
  'extracted_text',
] as const

export function projectionFor(collection: string): Record<string, 0 | 1> {
  const fields = FIELD_CLASSES[collection] ?? {}
  return { _id: 0, ...Object.fromEntries(Object.keys(fields).map((f) => [f, 1 as const])) }
}
