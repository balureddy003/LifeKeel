/**
 * Family signal schema registration.
 *
 * Signals persisted via persistSignal() are validated against the
 * SignalSchemaRegistry. Connector signals get their schemas from the
 * connectors/ directory; family signals (family.household, family.savings,
 * etc.) are emitted by the financial-profile route and life-events route
 * with no connector behind them, so they need schemas registered here
 * instead. Without this, every persistSignal() call logs a
 * "No schema registered" error — noise that buries real validation
 * failures.
 *
 * Schemas are permissive (passthrough for unknown fields) because the
 * signal data objects are assembled in code, not from external input —
 * the schema's job is to catch missing required fields and wrong types,
 * not to lock down every field name.
 */

import { z } from 'zod'
import { getSchemaRegistry } from './schema-registry.js'

const minorField = z.number().int().nonnegative().optional()
const optionalMemberId = z.string().optional()

const FAMILY_SCHEMAS = [
  {
    signal_type: 'family.household',
    schema: z.object({
      household_income_minor: z.number().int().nonnegative(),
      monthly_salary_minor: z.number().int().nonnegative(),
      employment_status: z.string(),
      other_income_minor: minorField,
      annual_living_expenses_minor: minorField,
      protection_gaps: z.array(z.string()).optional(),
      member_id: optionalMemberId,
    }).passthrough(),
    required_fields: ['household_income_minor', 'monthly_salary_minor', 'employment_status'],
    optional_fields: ['other_income_minor', 'annual_living_expenses_minor', 'protection_gaps', 'member_id'],
  },
  {
    signal_type: 'family.savings',
    schema: z.object({
      emergency_savings_minor: z.number().int().nonnegative(),
      monthly_expenses_minor: z.number().int().nonnegative(),
      has_high_interest_debt: z.number().int().min(0).max(1),
      high_interest_debt_balance_minor: minorField,
    }).passthrough(),
    required_fields: ['emergency_savings_minor', 'monthly_expenses_minor', 'has_high_interest_debt'],
    optional_fields: ['high_interest_debt_balance_minor'],
  },
  {
    signal_type: 'family.pension',
    schema: z.object({
      current_age: z.number().int().positive(),
      target_retirement_age: z.number().int().positive(),
      pension_balance_minor: z.number().int().nonnegative(),
      target_retirement_income_minor: z.number().int().nonnegative(),
      projected_retirement_age: z.number().int().positive().optional(),
      additional_monthly_contribution_needed_minor: minorField,
      achievable_retirement_income_minor: minorField,
      monthly_salary_minor: minorField,
      member_id: optionalMemberId,
    }).passthrough(),
    required_fields: ['current_age', 'target_retirement_age', 'pension_balance_minor', 'target_retirement_income_minor'],
    optional_fields: ['projected_retirement_age', 'additional_monthly_contribution_needed_minor', 'achievable_retirement_income_minor', 'monthly_salary_minor', 'member_id'],
  },
  {
    signal_type: 'family.education_fund',
    schema: z.object({
      child_name: z.string(),
      child_age: z.number().int().nonnegative(),
      current_savings_minor: z.number().int().nonnegative(),
      target_savings_minor: z.number().int().nonnegative(),
      years_remaining: z.number().nonnegative(),
      member_id: optionalMemberId,
    }).passthrough(),
    required_fields: ['child_name', 'child_age', 'current_savings_minor', 'target_savings_minor', 'years_remaining'],
    optional_fields: ['member_id'],
  },
  {
    signal_type: 'family.estate',
    schema: z.object({
      has_will: z.number().int().min(0).max(1),
      has_power_of_attorney: z.number().int().min(0).max(1),
      estate_doc_count: z.number().int().nonnegative(),
    }).passthrough(),
    required_fields: ['has_will', 'has_power_of_attorney', 'estate_doc_count'],
    optional_fields: [],
  },
  {
    signal_type: 'family.life_event',
    schema: z.object({
      event_type: z.string(),
      reported_at: z.string(),
      affected_member_id: optionalMemberId,
      reported_by_user_id: z.string().optional(),
      completed_step_ids: z.array(z.string()).optional(),
    }).passthrough(),
    required_fields: ['event_type', 'reported_at'],
    optional_fields: ['affected_member_id', 'reported_by_user_id', 'completed_step_ids'],
  },
] as const

export function registerFamilySignalSchemas(): void {
  const registry = getSchemaRegistry()
  for (const def of FAMILY_SCHEMAS) {
    registry.register({
      signal_type: def.signal_type,
      version: '0.0.0',
      schema: def.schema,
      required_fields: [...def.required_fields],
      optional_fields: [...def.optional_fields],
    })
  }
}
