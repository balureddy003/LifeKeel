/**
 * PRD-108: renders a life-event playbook template (playbooks/family/*.yaml
 * — content, not code, same spirit as detectors/family/*.yaml) against a
 * family's real financial profile. Deliberately NOT the engine's
 * interpolate() (packages/engine/src/evaluator.ts) — that's pure
 * {{field}} substitution with no exported public API and no conditionals,
 * and this needs real branching (disability's "how to claim" vs "why you
 * need cover"), so the handful of steps that need real logic are rendered
 * by small named functions here instead, keyed by step id.
 *
 * Playbook files live outside detectors/ on purpose: Engine.load() globs
 * every .yaml under detectorsDir and validates each as a detector config
 * (packages/engine/src/engine.ts) — a playbook file in detectors/family/
 * would fail that validation.
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { repoRoot, formatMoney } from '@agentoak/platform'
import type { FinancialProfile } from '../routes/family-financial-profile.js'

export type LifeEventType = 'job_loss' | 'bereavement' | 'disability'

export interface PlaybookStep {
  id: string
  title: string
  body: string
  /** Eligible for the prepare/draft affordance (PRD-103's insight.prepare, reused). */
  contact: boolean
}

export interface Playbook {
  event_type: LifeEventType
  title: string
  intro: string
  steps: PlaybookStep[]
}

interface RawPlaybookStep {
  id: string
  title: string
  body?: string
  computed?: boolean
  contact: boolean
}

interface RawPlaybook {
  event_type: LifeEventType
  title: string
  intro: string
  steps: RawPlaybookStep[]
}

/** Roster member this event is reported as affecting — name only, for display. */
export interface AffectedMember {
  id: string
  name: string
}

const PLAYBOOK_FILES: Record<LifeEventType, string> = {
  job_loss: 'job-loss.yaml',
  bereavement: 'bereavement.yaml',
  disability: 'disability.yaml',
}

// Loaded once per process, same pattern as category-table.yaml's load in
// apps/api/src/migrate.ts — playbook content doesn't change at runtime.
const rawPlaybookCache = new Map<LifeEventType, RawPlaybook>()

function loadRawPlaybook(eventType: LifeEventType): RawPlaybook {
  const cached = rawPlaybookCache.get(eventType)
  if (cached) return cached
  const filePath = path.join(repoRoot(), 'playbooks', 'family', PLAYBOOK_FILES[eventType])
  const raw = yaml.load(fs.readFileSync(filePath, 'utf8')) as RawPlaybook
  rawPlaybookCache.set(eventType, raw)
  return raw
}

/**
 * The earner this event affects: the matching household.members[] entry
 * (PRD-104) when affectedMemberId resolves to one, otherwise the
 * household's own (primary earner) fields — the PRD's own "ship without
 * PRD-104, degrade to household-level" fallback, now live since PRD-104
 * has landed.
 */
function resolveEarner(profile: FinancialProfile, affectedMemberId?: string) {
  if (affectedMemberId) {
    const member = profile.household.members.find((m) => m.member_id === affectedMemberId)
    if (member) {
      return {
        employment_status: member.employment_status,
        income_protection_monthly_minor: member.income_protection_monthly_minor,
        monthly_salary_minor: member.monthly_salary_minor,
      }
    }
  }
  return {
    employment_status: profile.household.employment_status,
    income_protection_monthly_minor: profile.household.income_protection_monthly_minor,
    monthly_salary_minor: profile.household.monthly_salary_minor,
  }
}

function formatMonths(months: number): string {
  if (months < 1) return 'less than a month'
  if (months === 1) return '1 month'
  return `${Math.floor(months)} months`
}

function renderJobLossStep(
  stepId: string,
  profile: FinancialProfile,
  affectedMemberId: string | undefined,
): string {
  const earner = resolveEarner(profile, affectedMemberId)

  if (stepId === 'runway') {
    const { emergency_savings_minor, monthly_expenses_minor } = profile.emergency_fund
    if (monthly_expenses_minor <= 0) {
      return "We don't have your monthly expenses on file yet, so we can't calculate a real runway — add them to your financial profile for an actual number instead of a guess."
    }
    const months = emergency_savings_minor / monthly_expenses_minor
    return `Based on your real numbers, your emergency savings of ${formatMoney(emergency_savings_minor)} cover about ${formatMonths(months)} at your current spend of ${formatMoney(monthly_expenses_minor)}/month.`
  }

  if (stepId === 'income_protection') {
    if (earner.income_protection_monthly_minor > 0) {
      return `You have ${formatMoney(earner.income_protection_monthly_minor)}/month of income protection on file — check your policy's exact waiting period and claim process now, before you need it urgently.`
    }
    return "You don't have income protection cover on file for this earner. It won't help with this job loss (most policies only pay out for illness or injury, not redundancy), but worth reviewing for next time."
  }

  if (stepId === 'notify_mortgage_lender') {
    if (profile.household.mortgage_outstanding_minor > 0) {
      return `You have a mortgage of ${formatMoney(profile.household.mortgage_outstanding_minor)} outstanding on file. Contact your lender early — many offer a payment holiday or reduced-payment plan for a temporary income gap, but only if you reach out before missing a payment.`
    }
    return "We don't have a mortgage on file for your household — if you do have one, contact your lender early; many offer a payment holiday for a temporary income gap."
  }

  return ''
}

function renderBereavementStep(stepId: string, profile: FinancialProfile): string {
  if (stepId === 'notify_insurers') {
    if (profile.policies.length === 0) {
      return "We don't have any policies on file for your family yet — if the person who passed away held any life insurance, health cover, or other policies, gather the provider details and contact each one to start a claim or notify them of the death."
    }
    const list = profile.policies
      .map((p) => `${p.provider} (${p.type.replace('_', ' ')})`)
      .join(', ')
    return `Based on your real data, your family's policies on file are: ${list}. Contact each provider to start a claim or notify them of the death.`
  }

  if (stepId === 'mortgage_protection_check') {
    const { mortgage_outstanding_minor, life_cover_minor } = profile.household
    if (mortgage_outstanding_minor <= 0) {
      return "We don't have a mortgage on file for your household, so this isn't something to worry about right now."
    }
    if (life_cover_minor >= mortgage_outstanding_minor) {
      return `Your life cover on file (${formatMoney(life_cover_minor)}) covers your outstanding mortgage (${formatMoney(mortgage_outstanding_minor)}) — worth confirming with your lender, but this shouldn't be an immediate financial threat.`
    }
    return `Your outstanding mortgage on file (${formatMoney(mortgage_outstanding_minor)}) is larger than the life cover on file (${formatMoney(life_cover_minor)}) — this is worth flagging to whoever is handling the estate, since the mortgage may not be fully covered.`
  }

  return ''
}

function renderDisabilityStep(
  stepId: string,
  profile: FinancialProfile,
  affectedMemberId: string | undefined,
): string {
  if (stepId === 'check_cover') {
    const earner = resolveEarner(profile, affectedMemberId)
    const hasCriticalIllnessPolicy = profile.policies.some((p) => p.type === 'critical_illness')
    const hasIncomeProtection = earner.income_protection_monthly_minor > 0

    if (hasIncomeProtection || hasCriticalIllnessPolicy) {
      const parts: string[] = []
      if (hasIncomeProtection) parts.push(`${formatMoney(earner.income_protection_monthly_minor)}/month of income protection`)
      if (hasCriticalIllnessPolicy) {
        const policy = profile.policies.find((p) => p.type === 'critical_illness')!
        parts.push(`a critical-illness policy with ${policy.provider}`)
      }
      return `Based on your real data, you have ${parts.join(' and ')} on file. Here's how to claim: contact the provider(s) directly, ask what documentation they need, and start the claim as soon as you're able — most have a waiting period before payments begin, so starting early matters.`
    }
    return "You don't have income protection or a critical-illness policy on file. Here's why that matters now: without either, there's no private cover to fall back on for lost income during this — the state disability benefit step below is worth checking regardless, and it's worth reviewing cover for the future once things stabilize."
  }

  return ''
}

function renderComputedStep(
  eventType: LifeEventType,
  stepId: string,
  profile: FinancialProfile,
  affectedMemberId: string | undefined,
): string {
  if (eventType === 'job_loss') return renderJobLossStep(stepId, profile, affectedMemberId)
  if (eventType === 'bereavement') return renderBereavementStep(stepId, profile)
  return renderDisabilityStep(stepId, profile, affectedMemberId)
}

export function renderPlaybook(
  eventType: LifeEventType,
  profile: FinancialProfile,
  affectedMemberId?: string,
): Playbook {
  const raw = loadRawPlaybook(eventType)
  return {
    event_type: raw.event_type,
    title: raw.title,
    intro: raw.intro,
    steps: raw.steps.map((step) => ({
      id: step.id,
      title: step.title,
      body: step.computed
        ? renderComputedStep(eventType, step.id, profile, affectedMemberId)
        : (step.body ?? '').trim(),
      contact: step.contact,
    })),
  }
}
