/**
 * Setup State Service — which setup steps this user's household has finished.
 *
 * Computed by code from saved records, never by the model (design D2). Each
 * reader loads only fields listed in field-classes.ts and returns counts and
 * booleans. A reader that fails makes its steps `unknown` — never `done` or
 * `not_started` (D14). Completion comes only from saved server records, not
 * from chat replies, page visits or defaults.
 */
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { FamilyGroupDoc, FamilyMemberDoc } from '../routes/family-group.js'
import { isMinorMember, memberMatchesUser } from '../family/family-permissions.js'
import type { KeelContext } from './context.js'
import { projectionFor } from './field-classes.js'
import type { RouteKey } from './route-keys.js'

export type StepStatus =
  'done' | 'partial' | 'not_started' | 'not_applicable' | 'waiting_on_other' | 'blocked' | 'unknown'

export type StepId =
  | 'household_created'
  | 'partner_invited'
  | 'children_added'
  | 'income_recorded'
  | 'expenses_recorded'
  | 'emergency_fund_recorded'
  | 'protection_on_file'
  | 'education_goals'
  | 'documents_uploaded'
  | 'notifications_configured'
  | 'mfa_enabled'
  | 'emergency_contacts'

export interface SetupStep {
  id: StepId
  title: string
  status: StepStatus
  reason_code?: string
  /** Counts and booleans only — never amounts, names or document text. */
  evidence: Record<string, number | boolean>
  route_key: RouteKey
  anchor?: string
  est_minutes: number
  can_act: boolean
  hint?: string
  source_updated_at: string | null
}

export interface SetupState {
  bootstrap: boolean
  role: 'organizer' | 'editor' | 'viewer' | 'child' | 'none'
  household: { adults: number; children: number; pending_members: number }
  completed: number
  total: number
  verified_complete: boolean
  next_step_id: StepId | null
  next_step_ids: StepId[]
  steps: SetupStep[]
  catalog_version: 1
  data_as_of: string
}

type Read<T> = { ok: true; value: T } | { ok: false }

interface ProfileSlice {
  employment_status?: string
  monthly_salary_minor: number
  annual_living_expenses_minor: number
  life_cover_minor: number
  emergency_savings_minor: number
  monthly_expenses_minor: number
  policies: Array<{ type?: string; member_id?: string }>
  education_member_ids: string[]
  updated_at: string | null
}

interface Snapshot {
  family: Read<FamilyMemberDoc[]>
  profile: Read<ProfileSlice | null>
  documents: Read<{ applied: number; other: number }>
  prefsReviewed: Read<boolean>
  mfa: Read<boolean>
  contacts: Read<number>
  skipped: Read<StepId[]>
}

async function read<T>(fn: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch {
    return { ok: false }
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export async function loadSnapshot(db: Db, ctx: KeelContext): Promise<Snapshot> {
  const t = ctx.tenant_id
  // Independent reads, so they run together; each one fails on its own (see read()).
  const [family, profile, documents, prefsReviewed, mfa, contacts, skipped] = await Promise.all([
    read(async () => {
      const doc = await getTenantCollection<FamilyGroupDoc>(db, 'family_groups', t).findOne(
        {},
        { projection: projectionFor('family_groups') },
      )
      return doc?.members ?? []
    }),
    read(async (): Promise<ProfileSlice | null> => {
      const doc = (await getTenantCollection<Record<string, unknown>>(
        db,
        'family_financial_profile',
        t,
      ).findOne({}, { projection: projectionFor('family_financial_profile') })) as {
        household?: Record<string, unknown>
        emergency_fund?: Record<string, unknown>
        policies?: Array<{ type?: string; member_id?: string }>
        education_funds?: Array<{ member_id?: string }>
        updated_at?: Date | string
      } | null
      if (!doc) return null
      const updated = doc.updated_at ? new Date(doc.updated_at).toISOString() : null
      return {
        ...(typeof doc.household?.['employment_status'] === 'string'
          ? { employment_status: doc.household['employment_status'] as string }
          : {}),
        monthly_salary_minor: num(doc.household?.['monthly_salary_minor']),
        annual_living_expenses_minor: num(doc.household?.['annual_living_expenses_minor']),
        life_cover_minor: num(doc.household?.['life_cover_minor']),
        emergency_savings_minor: num(doc.emergency_fund?.['emergency_savings_minor']),
        monthly_expenses_minor: num(doc.emergency_fund?.['monthly_expenses_minor']),
        policies: doc.policies ?? [],
        education_member_ids: (doc.education_funds ?? [])
          .map((f) => f.member_id)
          .filter((id): id is string => typeof id === 'string'),
        updated_at: updated,
      }
    }),
    read(async () => {
      const col = getTenantCollection(db, 'documents', t)
      const [applied, other] = await Promise.all([
        col.countDocuments({ status: 'applied' }),
        col.countDocuments({ status: { $in: ['stored', 'clean', 'processing', 'extracted'] } }),
      ])
      return { applied, other }
    }),
    read(async () => {
      const doc = (await getTenantCollection(db, 'delivery_preferences', t).findOne(
        {},
        { projection: projectionFor('delivery_preferences') },
      )) as { reviewed_at?: unknown } | null
      return Boolean(doc?.reviewed_at)
    }),
    read(async () => {
      const doc = (await getTenantCollection(db, 'users', t).findOne(
        { id: ctx.user_id },
        { projection: projectionFor('users') },
      )) as { mfa_enabled?: boolean } | null
      return doc?.mfa_enabled === true
    }),
    read(() => getTenantCollection(db, 'legacy_contacts', t).countDocuments({})),
    read(async () => {
      const doc = (await getTenantCollection(db, 'keel_preferences', t).findOne({
        user_id: ctx.user_id,
      })) as { skipped_steps?: StepId[] } | null
      return doc?.skipped_steps ?? []
    }),
  ])
  return { family, profile, documents, prefsReviewed, mfa, contacts, skipped }
}

type Who = 'organizer' | 'editor' | 'self'

interface Evaluation {
  status: StepStatus
  reason_code?: string
  evidence: Record<string, number | boolean>
  /** Which reader failure makes this step unknown. */
  needs: Array<keyof Snapshot>
  updated?: string | null
}

interface StepDef {
  id: StepId
  title: string
  route_key: RouteKey
  anchor?: string
  est_minutes: number
  who: Who
  evaluate: (s: Snapshot, ctx: KeelContext) => Evaluation
}

const COVER_TYPES = new Set(['life', 'income_protection', 'health', 'critical_illness'])

function roster(s: Snapshot): FamilyMemberDoc[] {
  return s.family.ok ? s.family.value : []
}
const adultsOf = (m: FamilyMemberDoc[]) =>
  m.filter((x) => x.status === 'active' && !isMinorMember(x))
const childrenOf = (m: FamilyMemberDoc[]) => m.filter((x) => isMinorMember(x))

const STEP_DEFS: StepDef[] = [
  {
    id: 'household_created',
    title: 'Create your household',
    route_key: 'family',
    est_minutes: 2,
    who: 'self',
    evaluate: (s) => ({
      status: roster(s).length > 0 ? 'done' : 'not_started',
      evidence: { members: roster(s).length },
      needs: ['family'],
    }),
  },
  {
    id: 'partner_invited',
    title: 'Invite the other adult in your household',
    route_key: 'family',
    est_minutes: 2,
    who: 'organizer',
    evaluate: (s, ctx) => {
      const others = roster(s).filter(
        (m) => !isMinorMember(m) && !memberMatchesUser(m, ctx.user_id),
      )
      const active = others.filter((m) => m.status === 'active').length
      const pending = others.filter((m) => m.status === 'pending').length
      return {
        status: active > 0 ? 'done' : pending > 0 ? 'waiting_on_other' : 'not_started',
        ...(pending > 0 && active === 0 ? { reason_code: 'invite_pending' } : {}),
        evidence: { other_adults_active: active, other_adults_pending: pending },
        needs: ['family'],
      }
    },
  },
  {
    id: 'children_added',
    title: 'Add your children to the household',
    route_key: 'family',
    est_minutes: 3,
    who: 'editor',
    evaluate: (s) => {
      const kids = childrenOf(roster(s))
      const noDob = kids.filter((k) => !k.date_of_birth).length
      return {
        status: kids.length === 0 ? 'not_started' : noDob > 0 ? 'partial' : 'done',
        ...(noDob > 0 ? { reason_code: 'missing_date_of_birth' } : {}),
        evidence: { children: kids.length, children_missing_dob: noDob },
        needs: ['family'],
      }
    },
  },
  {
    id: 'income_recorded',
    title: 'Record household income',
    route_key: 'financial-profile.income',
    est_minutes: 3,
    who: 'editor',
    evaluate: (s) => {
      const p = s.profile.ok ? s.profile.value : null
      const entered =
        p !== null &&
        (p.monthly_salary_minor > 0 ||
          p.employment_status === 'unemployed' ||
          p.employment_status === 'retired')
      return {
        status: p === null ? 'not_started' : entered ? 'done' : 'partial',
        evidence: { profile_saved: p !== null, income_entered: entered },
        needs: ['profile'],
        updated: p?.updated_at ?? null,
      }
    },
  },
  {
    id: 'expenses_recorded',
    title: 'Record household living expenses',
    route_key: 'financial-profile.emergency',
    est_minutes: 3,
    who: 'editor',
    evaluate: (s) => {
      const p = s.profile.ok ? s.profile.value : null
      const entered =
        p !== null && (p.annual_living_expenses_minor > 0 || p.monthly_expenses_minor > 0)
      return {
        status: p === null ? 'not_started' : entered ? 'done' : 'partial',
        evidence: { profile_saved: p !== null, expenses_entered: entered },
        needs: ['profile'],
        updated: p?.updated_at ?? null,
      }
    },
  },
  {
    id: 'emergency_fund_recorded',
    title: 'Record your emergency savings',
    route_key: 'financial-profile.emergency',
    est_minutes: 2,
    who: 'editor',
    evaluate: (s) => {
      const p = s.profile.ok ? s.profile.value : null
      const entered = p !== null && p.emergency_savings_minor > 0
      return {
        status: p === null ? 'not_started' : entered ? 'done' : 'partial',
        evidence: { profile_saved: p !== null, savings_entered: entered },
        needs: ['profile'],
        updated: p?.updated_at ?? null,
      }
    },
  },
  {
    id: 'protection_on_file',
    title: 'Record the protection you already have',
    route_key: 'financial-profile.protection',
    anchor: 'policies',
    est_minutes: 3,
    who: 'editor',
    evaluate: (s) => {
      const everyone = roster(s).filter((m) => !isMinorMember(m))
      const active = adultsOf(roster(s))
      const pending = everyone.length - active.length
      const p = s.profile.ok ? s.profile.value : null
      const coveredIds = new Set(
        (p?.policies ?? [])
          .filter((x) => x.type && COVER_TYPES.has(x.type) && x.member_id)
          .map((x) => x.member_id as string),
      )
      const covered = active.filter((a) => coveredIds.has(a.id)).length
      const anyCover = covered > 0 || (p?.life_cover_minor ?? 0) > 0
      // A pending adult confirms their own cover after joining; nobody enters it for them.
      const status: StepStatus =
        everyone.length === 0
          ? 'not_applicable'
          : covered === active.length
            ? pending > 0
              ? 'waiting_on_other'
              : 'done'
            : anyCover
              ? 'partial'
              : 'not_started'
      return {
        status,
        ...(status === 'waiting_on_other' ? { reason_code: 'adult_pending' } : {}),
        evidence: { adults: everyone.length, adults_with_cover_recorded: covered },
        needs: ['family', 'profile'],
        updated: p?.updated_at ?? null,
      }
    },
  },
  {
    id: 'education_goals',
    title: "Add each child's education goal",
    route_key: 'financial-profile.education',
    est_minutes: 3,
    who: 'editor',
    evaluate: (s) => {
      const kids = childrenOf(roster(s))
      const p = s.profile.ok ? s.profile.value : null
      const withGoal = kids.filter((k) => p?.education_member_ids.includes(k.id)).length
      return {
        status:
          kids.length === 0
            ? 'not_applicable'
            : withGoal === kids.length
              ? 'done'
              : withGoal > 0
                ? 'partial'
                : 'not_started',
        evidence: { children: kids.length, children_with_goal: withGoal },
        needs: ['family', 'profile'],
        updated: p?.updated_at ?? null,
      }
    },
  },
  {
    id: 'documents_uploaded',
    title: 'Upload and review a policy or estate document',
    route_key: 'upload',
    est_minutes: 5,
    who: 'editor',
    evaluate: (s) => {
      const d = s.documents.ok ? s.documents.value : { applied: 0, other: 0 }
      return {
        status: d.applied > 0 ? 'done' : d.other > 0 ? 'partial' : 'not_started',
        ...(d.applied === 0 && d.other > 0 ? { reason_code: 'needs_review' } : {}),
        evidence: { documents_reviewed: d.applied, documents_awaiting_review: d.other },
        needs: ['documents'],
      }
    },
  },
  {
    id: 'notifications_configured',
    title: 'Choose how Keel keeps you posted',
    route_key: 'settings.notifications',
    est_minutes: 2,
    who: 'organizer',
    evaluate: (s) => ({
      status: s.prefsReviewed.ok && s.prefsReviewed.value ? 'done' : 'not_started',
      evidence: { preferences_saved: s.prefsReviewed.ok && s.prefsReviewed.value },
      needs: ['prefsReviewed'],
    }),
  },
  {
    id: 'mfa_enabled',
    title: 'Turn on two-step sign-in for your account',
    route_key: 'settings.security',
    est_minutes: 3,
    who: 'self',
    evaluate: (s) => ({
      status: s.mfa.ok && s.mfa.value ? 'done' : 'not_started',
      evidence: { mfa_enabled: s.mfa.ok && s.mfa.value },
      needs: ['mfa'],
    }),
  },
  {
    id: 'emergency_contacts',
    title: 'Name your emergency contacts',
    route_key: 'legacy',
    est_minutes: 3,
    who: 'editor',
    evaluate: (s) => {
      const n = s.contacts.ok ? s.contacts.value : 0
      return {
        status: n > 0 ? 'done' : 'not_started',
        evidence: { contacts: n },
        needs: ['contacts'],
      }
    },
  },
]

export const STEP_IDS = STEP_DEFS.map((d) => d.id)
export const STEP_TITLES = Object.fromEntries(STEP_DEFS.map((d) => [d.id, d.title])) as Record<
  StepId,
  string
>

function canAct(who: Who, ctx: KeelContext): boolean {
  if (who === 'self') return true
  if (who === 'organizer') return ctx.isOrganizer
  return ctx.isEditor
}

function roleOf(ctx: KeelContext): SetupState['role'] {
  if (ctx.isMinor) return 'child'
  if (!ctx.hasFamily) return 'none'
  if (ctx.isOrganizer) return 'organizer'
  return ctx.isEditor ? 'editor' : 'viewer'
}

const BOOTSTRAP_STEP: SetupStep = {
  id: 'household_created',
  title: 'Create your household',
  status: 'not_started',
  evidence: {},
  route_key: 'family-setup',
  est_minutes: 3,
  can_act: true,
  source_updated_at: null,
}

export function computeSetupState(snapshot: Snapshot, ctx: KeelContext): SetupState {
  const data_as_of = new Date().toISOString()
  const base = { catalog_version: 1 as const, data_as_of, role: roleOf(ctx) }

  if (ctx.isMinor) {
    return {
      ...base,
      bootstrap: false,
      household: { adults: 0, children: 0, pending_members: 0 },
      completed: 0,
      total: 0,
      verified_complete: false,
      next_step_id: null,
      next_step_ids: [],
      steps: [],
    }
  }

  if (!ctx.hasFamily) {
    return {
      ...base,
      bootstrap: true,
      household: { adults: 0, children: 0, pending_members: 0 },
      completed: 0,
      total: 1,
      verified_complete: false,
      next_step_id: 'household_created',
      next_step_ids: ['household_created'],
      steps: [BOOTSTRAP_STEP],
    }
  }

  const skipped = new Set(snapshot.skipped.ok ? snapshot.skipped.value : [])
  const steps: SetupStep[] = STEP_DEFS.map((def) => {
    const ev = def.evaluate(snapshot, ctx)
    const failed = ev.needs.some((k) => !snapshot[k].ok)
    const actor = canAct(def.who, ctx)
    let status: StepStatus = ev.status
    let reason_code = ev.reason_code
    let hint: string | undefined

    if (failed) {
      status = 'unknown'
      reason_code = 'reader_failed'
    } else if (status !== 'done' && skipped.has(def.id)) {
      status = 'not_applicable'
      reason_code = 'skipped_by_user'
    } else if (!actor && (status === 'not_started' || status === 'partial')) {
      status = 'blocked'
      reason_code = 'role_cannot_act'
      hint =
        def.who === 'organizer'
          ? 'Your household organizer can do this.'
          : 'An editor in your household can do this.'
    }

    return {
      id: def.id,
      title: def.title,
      status,
      ...(reason_code ? { reason_code } : {}),
      evidence: failed ? {} : ev.evidence,
      route_key: def.route_key,
      ...(def.anchor ? { anchor: def.anchor } : {}),
      est_minutes: def.est_minutes,
      can_act: actor,
      ...(hint ? { hint } : {}),
      source_updated_at: ev.updated ?? null,
    }
  })

  const members = roster(snapshot)
  const applicable = steps.filter((s) => s.status !== 'not_applicable')
  const completed = applicable.filter((s) => s.status === 'done').length
  const next = steps.filter(
    (s) => s.can_act && (s.status === 'not_started' || s.status === 'partial'),
  )

  return {
    ...base,
    bootstrap: false,
    household: {
      // Household shape for presets: everyone on the roster, pending adults included.
      adults: members.filter((m) => !isMinorMember(m)).length,
      children: childrenOf(members).length,
      pending_members: members.filter((m) => m.status === 'pending').length,
    },
    completed,
    total: applicable.length,
    verified_complete: applicable.length > 0 && completed === applicable.length,
    next_step_id: next[0]?.id ?? null,
    next_step_ids: next.slice(0, 3).map((s) => s.id),
    steps,
  }
}

export async function getSetupState(db: Db, ctx: KeelContext): Promise<SetupState> {
  if (!ctx.hasFamily || ctx.isMinor) return computeSetupState(emptySnapshot(), ctx)
  return computeSetupState(await loadSnapshot(db, ctx), ctx)
}

function emptySnapshot(): Snapshot {
  return {
    family: { ok: true, value: [] },
    profile: { ok: true, value: null },
    documents: { ok: true, value: { applied: 0, other: 0 } },
    prefsReviewed: { ok: true, value: false },
    mfa: { ok: true, value: false },
    contacts: { ok: true, value: 0 },
    skipped: { ok: true, value: [] },
  }
}
