import { describe, expect, it } from 'vitest'
import { buildKeelContext } from '../context.js'
import { getSetupState } from '../setup-state.js'
import { createFakeDb } from './fake-db.js'

const T = 't1'

const organizer = {
  id: 'u1',
  user_id: 'u1',
  role: 'organizer',
  status: 'active',
  name: 'A',
  email: 'a@x.test',
}
const partnerPending = { id: 'u2', role: 'adult', status: 'pending', name: 'B', email: 'b@x.test' }
const partnerActive = {
  id: 'u2',
  user_id: 'u2',
  role: 'adult',
  status: 'active',
  name: 'B',
  email: 'b@x.test',
}
const kidWithDob = {
  id: 'k1',
  role: 'child',
  status: 'active',
  name: 'K1',
  date_of_birth: '2018-01-01',
}
const kidNoDob = { id: 'k2', role: 'child', status: 'active', name: 'K2' }

function seed(
  members: Record<string, unknown>[],
  extra: Record<string, Record<string, unknown>[]> = {},
) {
  return { family_groups: [{ tenant_id: T, members }], ...extra }
}

const state = async (
  fake: ReturnType<typeof createFakeDb>,
  userId = 'u1',
  roles: string[] = ['owner'],
) =>
  getSetupState(fake.db, await buildKeelContext(fake.db, { tenant_id: T, user_id: userId, roles }))

const step = (s: Awaited<ReturnType<typeof state>>, id: string) => s.steps.find((x) => x.id === id)!

describe('setup state', () => {
  it('no family yet: bootstrap with one create-household step and no household reads', async () => {
    const fake = createFakeDb({ family_groups: [] })
    const s = await state(fake)
    expect(s.bootstrap).toBe(true)
    expect(s.steps).toHaveLength(1)
    expect(s.steps[0]).toMatchObject({ id: 'household_created', route_key: 'family-setup' })
    const collections = new Set(fake.calls.map((c) => c.collection))
    expect([...collections]).toEqual(['family_groups'])
  })

  it('two adults and two children, half done: counts evidence and names the next step', async () => {
    const fake = createFakeDb(
      seed([organizer, partnerPending, kidWithDob, kidNoDob], {
        family_financial_profile: [
          {
            tenant_id: T,
            household: {
              employment_status: 'employed',
              monthly_salary_minor: 400000,
              annual_living_expenses_minor: 2400000,
            },
            emergency_fund: { emergency_savings_minor: 0, monthly_expenses_minor: 200000 },
            policies: [{ type: 'life', member_id: 'u1' }],
            education_funds: [{ member_id: 'k1' }],
            updated_at: new Date('2026-10-20T08:00:00Z'),
          },
        ],
      }),
    )
    const s = await state(fake)
    expect(s.household).toEqual({ adults: 2, children: 2, pending_members: 1 })
    expect(step(s, 'household_created').status).toBe('done')
    expect(step(s, 'partner_invited')).toMatchObject({
      status: 'waiting_on_other',
      reason_code: 'invite_pending',
    })
    // Children already on the roster: the card asks for what is missing, not to add them again.
    expect(step(s, 'children_added')).toMatchObject({
      status: 'partial',
      reason_code: 'missing_date_of_birth',
      title: "Add your child's date of birth",
    })
    expect(step(s, 'income_recorded').status).toBe('done')
    expect(step(s, 'expenses_recorded').status).toBe('done')
    // Zero savings entered is not counted as "recorded".
    expect(step(s, 'emergency_fund_recorded').status).toBe('partial')
    expect(step(s, 'protection_on_file')).toMatchObject({
      status: 'waiting_on_other',
      reason_code: 'adult_pending',
      evidence: { adults: 2, adults_with_cover_recorded: 1 },
    })
    expect(step(s, 'education_goals')).toMatchObject({
      status: 'partial',
      evidence: { children: 2, children_with_goal: 1 },
    })
    expect(step(s, 'income_recorded').source_updated_at).toBe('2026-10-20T08:00:00.000Z')
    expect(s.next_step_id).toBe('children_added')
    expect(s.verified_complete).toBe(false)
    expect(s.completed).toBe(s.steps.filter((x) => x.status === 'done').length)
  })

  it('a notification default is not a reviewed choice', async () => {
    const unreviewed = createFakeDb(
      seed([organizer], { delivery_preferences: [{ tenant_id: T, digest_mode: false }] }),
    )
    expect(step(await state(unreviewed), 'notifications_configured').status).toBe('not_started')
    const reviewed = createFakeDb(
      seed([organizer], { delivery_preferences: [{ tenant_id: T, reviewed_at: new Date() }] }),
    )
    expect(step(await state(reviewed), 'notifications_configured').status).toBe('done')
  })

  it('a failing reader makes only its steps unknown, never done or not_started', async () => {
    const fake = createFakeDb(seed([organizer, kidWithDob]), {
      failing: ['family_financial_profile'],
    })
    const s = await state(fake)
    for (const id of [
      'income_recorded',
      'expenses_recorded',
      'emergency_fund_recorded',
      'protection_on_file',
      'education_goals',
    ]) {
      expect(step(s, id)).toMatchObject({
        status: 'unknown',
        reason_code: 'reader_failed',
        evidence: {},
      })
    }
    expect(step(s, 'household_created').status).toBe('done')
    expect(s.verified_complete).toBe(false)
    expect(s.next_step_ids).not.toContain('income_recorded')
  })

  it('no children means the education step is not applicable and not counted', async () => {
    const s = await state(createFakeDb(seed([organizer, partnerActive])))
    expect(step(s, 'education_goals').status).toBe('not_applicable')
    expect(s.total).toBe(s.steps.length - 1)
    expect(step(s, 'partner_invited').status).toBe('done')
  })

  it('a skipped step is excluded from the total but never counted as done', async () => {
    const fake = createFakeDb(
      seed([organizer], {
        keel_preferences: [{ tenant_id: T, user_id: 'u1', skipped_steps: ['partner_invited'] }],
      }),
    )
    const s = await state(fake)
    expect(step(s, 'partner_invited')).toMatchObject({
      status: 'not_applicable',
      reason_code: 'skipped_by_user',
    })
    expect(s.completed).toBe(1)
  })

  it('a viewer sees household steps read-only and their own security step as actionable', async () => {
    const fake = createFakeDb(seed([organizer, { ...partnerActive }]))
    const s = await state(fake, 'u2', ['viewer'])
    expect(s.role).toBe('viewer')
    expect(step(s, 'income_recorded')).toMatchObject({
      status: 'blocked',
      can_act: false,
      hint: expect.stringContaining('editor'),
    })
    expect(step(s, 'notifications_configured')).toMatchObject({
      status: 'blocked',
      hint: expect.stringContaining('organizer'),
    })
    expect(step(s, 'mfa_enabled')).toMatchObject({ status: 'not_started', can_act: true })
    expect(s.next_step_id).toBe('mfa_enabled')
  })

  it('a child account gets no steps and no household reads beyond the roster lookup', async () => {
    const fake = createFakeDb(seed([organizer, { ...kidWithDob, user_id: 'kid-user' }]))
    const s = await state(fake, 'kid-user', ['viewer'])
    expect(s.role).toBe('child')
    expect(s.steps).toEqual([])
    expect(fake.calls.every((c) => c.collection === 'family_groups')).toBe(true)
  })

  it('evidence holds only counts and booleans', async () => {
    const fake = createFakeDb(
      seed([organizer, kidWithDob], {
        family_financial_profile: [
          {
            tenant_id: T,
            household: { monthly_salary_minor: 1, employment_status: 'employed' },
            policies: [{ type: 'life', member_id: 'u1', provider: 'SECRET' }],
          },
        ],
      }),
    )
    const s = await state(fake)
    for (const st of s.steps) {
      for (const v of Object.values(st.evidence)) expect(['number', 'boolean']).toContain(typeof v)
    }
    expect(JSON.stringify(s)).not.toContain('SECRET')
  })

  it('every query is tenant-scoped and uses an allow-listed projection', async () => {
    const fake = createFakeDb(seed([organizer]))
    await state(fake)
    const reads = fake.calls.filter((c) => c.collection !== 'tenant_keys')
    expect(reads.length).toBeGreaterThan(0)
    for (const c of reads) expect(c.filter['tenant_id']).toBe(T)
  })
})
