/**
 * PRD-108: life-event response playbooks. Covers the PRD's literal
 * acceptance criteria — job-loss runway is the family's real numbers, not
 * a placeholder; bereavement lists real policies by provider/type;
 * disability's guidance branches on real cover — plus the prepare route's
 * no-send-path guardrail (mirrors insights-prepare.test.ts's own).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { registerLifeEventRoutes } from '../life-events.js'

const TENANT = 'tenant-life-events-test'

const llmMock = vi.fn(async (_system: string, prompt: string) => `Draft based on: ${prompt}`)

vi.mock('@agentoak/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentoak/platform')>()
  return { ...actual, createLlmRouterFromEnv: () => llmMock }
})

interface StoredSignal {
  id: string
  tenant_id: string
  signal_type: string
  data: Record<string, unknown>
  created_at: Date
}

let signalsStore: StoredSignal[] = []

vi.mock('../../signals.js', () => ({
  persistSignal: vi.fn(async (input: { id?: string; tenant_id: string; signal_type: string; data: Record<string, unknown> }) => {
    const id = input.id ?? `signal-${signalsStore.length + 1}`
    signalsStore.push({ id, tenant_id: input.tenant_id, signal_type: input.signal_type, data: input.data, created_at: new Date() })
    return id
  }),
}))

interface NudgeStateDoc {
  tenant_id: string
  active: boolean
  reason?: string
  triggered_at?: Date
}
let nudgeStateStore: NudgeStateDoc[] = []

vi.mock('../../db.js', () => ({
  // PRD-111: a plain in-memory stand-in for family_life_change_nudge_state —
  // getLifeChangeNudgeStateCollection is a trivial database.collection(name)
  // wrapper in real code, so the mock can be equally trivial here.
  getLifeChangeNudgeStateCollection: vi.fn(() => ({
    findOne: async (filter: Record<string, unknown>) =>
      nudgeStateStore.find((d) => d.tenant_id === filter['tenant_id'] && (filter['active'] === undefined || d.active === filter['active'])) ?? null,
    updateOne: async (filter: Record<string, unknown>, update: { $set: Partial<NudgeStateDoc> }, opts?: { upsert?: boolean }) => {
      let doc = nudgeStateStore.find((d) => d.tenant_id === filter['tenant_id'])
      if (!doc) {
        if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 }
        doc = { tenant_id: filter['tenant_id'] as string, active: false }
        nudgeStateStore.push(doc)
      }
      Object.assign(doc, update.$set)
      return { matchedCount: 1, modifiedCount: 1 }
    },
  })),
  getSignalsCollection: vi.fn(async () => ({
    find: (filter: Record<string, unknown>) => ({
      sort: () => ({
        toArray: async () =>
          signalsStore
            .filter((s) => s.tenant_id === filter['tenant_id'] && s.signal_type === filter['signal_type'])
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
      }),
    }),
    findOne: async (filter: Record<string, unknown>) =>
      signalsStore.find(
        (s) => s.tenant_id === filter['tenant_id'] && s.signal_type === filter['signal_type'] && s.id === filter['id'],
      ) ?? null,
    // Just enough of the driver's updateOne for the complete endpoint —
    // handles the two ops it actually sends ($addToSet / $pull on
    // data.completed_step_ids).
    updateOne: async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      const doc = signalsStore.find(
        (s) => s.tenant_id === filter['tenant_id'] && s.signal_type === filter['signal_type'] && s.id === filter['id'],
      )
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      if (update['$addToSet']) {
        const ids = (doc.data['completed_step_ids'] as string[] | undefined) ?? []
        for (const v of Object.values(update['$addToSet'])) if (!ids.includes(v as string)) ids.push(v as string)
        doc.data['completed_step_ids'] = ids
      }
      if (update['$pull']) {
        const remove = new Set(Object.values(update['$pull']) as string[])
        doc.data['completed_step_ids'] = ((doc.data['completed_step_ids'] as string[] | undefined) ?? []).filter((v) => !remove.has(v))
      }
      return { matchedCount: 1, modifiedCount: 1 }
    },
  })),
}))

const BASE_PROFILE = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 3600000,
    mortgage_outstanding_minor: 20_000_000,
    life_cover_minor: 10_000_000,
    income_protection_monthly_minor: 400000,
    members: [] as Array<{ member_id: string; employment_status: string; monthly_salary_minor: number; income_protection_monthly_minor: number }>,
  },
  emergency_fund: {
    emergency_savings_minor: 900000,
    monthly_expenses_minor: 300000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 30,
    target_retirement_age: 65,
    pension_balance_minor: 5_000_000,
    monthly_contribution_minor: 50000,
    target_retirement_income_minor: 3_000_000,
    expected_annual_growth_pct: 5,
  },
  education_funds: [] as unknown[],
  policies: [] as Array<{ type: string; provider: string; coverage_amount_minor: number; monthly_premium_minor: number }>,
}

beforeEach(() => {
  nudgeStateStore = []
})

function makeDb(profile: typeof BASE_PROFILE | null) {
  const col = {
    findOne: vi.fn(async () => profile),
  }
  return { collection: () => col } as any
}

async function buildApp(profile: typeof BASE_PROFILE | null = BASE_PROFILE) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerLifeEventRoutes(app, makeDb(profile))
  return { app }
}

describe('PRD-108: POST /family/life-events', () => {
  beforeEach(() => {
    signalsStore = []
    llmMock.mockClear()
  })

  it('rejects reporting a life event before any financial profile exists', async () => {
    const { app } = await buildApp(null)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an unknown event_type', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'divorce' } })
    expect(res.statusCode).toBe(400)
  })

  it("this session's exact acceptance criterion — job-loss runway shows the real emergency fund ÷ real monthly expenses, not a placeholder", async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })
    expect(res.statusCode).toBe(201)

    const runwayStep = res.json().playbook.steps.find((s: { id: string }) => s.id === 'runway')
    // 900,000 minor / 300,000 minor = 3 months exactly — the real BASE_PROFILE numbers, not sample text.
    expect(runwayStep.body).toContain('3 months')
    expect(runwayStep.body).not.toMatch(/sample|placeholder/i)
  })

  it('bereavement lists the family\'s actual policies by provider and type', async () => {
    const profile = {
      ...BASE_PROFILE,
      policies: [
        { type: 'life', provider: 'Aviva', coverage_amount_minor: 10_000_000, monthly_premium_minor: 2000 },
        { type: 'critical_illness', provider: 'Bupa', coverage_amount_minor: 5_000_000, monthly_premium_minor: 1500 },
      ],
    }
    const { app } = await buildApp(profile)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'bereavement' } })

    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'notify_insurers')
    expect(step.body).toContain('Aviva')
    expect(step.body).toContain('life')
    expect(step.body).toContain('Bupa')
    expect(step.body).toContain('critical illness')
  })

  it('bereavement gives an honest no-policies-on-file line rather than a placeholder when policies[] is empty', async () => {
    const { app } = await buildApp(BASE_PROFILE)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'bereavement' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'notify_insurers')
    expect(step.body).toMatch(/don't have any policies on file/i)
  })

  it('disability: a family with real cover in place gets "how to claim" guidance, not "why you need cover"', async () => {
    const profile = {
      ...BASE_PROFILE,
      household: { ...BASE_PROFILE.household, income_protection_monthly_minor: 400000 },
      policies: [{ type: 'critical_illness', provider: 'Bupa', coverage_amount_minor: 5_000_000, monthly_premium_minor: 1500 }],
    }
    const { app } = await buildApp(profile)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'disability' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_cover')
    expect(step.body).toMatch(/how to claim/i)
    expect(step.body).toContain('Bupa')
    expect(step.body).not.toMatch(/why (that|this) matters/i)
  })

  it('disability: a family with no income protection and no critical-illness policy gets "why you need cover" guidance, not a false claim path', async () => {
    const profile = { ...BASE_PROFILE, household: { ...BASE_PROFILE.household, income_protection_monthly_minor: 0 }, policies: [] }
    const { app } = await buildApp(profile)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'disability' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_cover')
    expect(step.body).toMatch(/why that matters/i)
    expect(step.body).not.toMatch(/how to claim/i)
  })

  it('resolves a reported member_id against household.members[] (PRD-104) rather than only the household total', async () => {
    const profile = {
      ...BASE_PROFILE,
      household: {
        ...BASE_PROFILE.household,
        income_protection_monthly_minor: 0,
        members: [{ member_id: 'member-1', employment_status: 'employed', monthly_salary_minor: 300000, income_protection_monthly_minor: 300000 }],
      },
    }
    const { app } = await buildApp(profile)
    const res = await app.inject({
      method: 'POST',
      url: '/family/life-events',
      payload: { event_type: 'disability', affected_member_id: 'member-1' },
    })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_cover')
    // The primary earner has no income protection, but the affected member does — the member's real cover should drive the branch.
    expect(step.body).toMatch(/how to claim/i)
  })
})

describe('Emergency-Mode taxonomy: medical / car / property / travel', () => {
  beforeEach(() => {
    signalsStore = []
  })

  it.each(['medical', 'car', 'property', 'travel'] as const)(
    'accepts %s and returns a rendered playbook — the full crisis-tile taxonomy now has a real flow',
    async (eventType) => {
      const { app } = await buildApp()
      const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: eventType } })
      expect(res.statusCode).toBe(201)
      const playbook = res.json().playbook
      expect(playbook.event_type).toBe(eventType)
      expect(playbook.steps.length).toBeGreaterThan(0)
    },
  )

  it('car: names the real car policy provider and policy number', async () => {
    const profile = {
      ...BASE_PROFILE,
      policies: [{ type: 'car', provider: 'Admiral', coverage_amount_minor: 5_000_000, monthly_premium_minor: 3000, policy_number: 'CAR-991' }],
    }
    const { app } = await buildApp(profile)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'car' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_car_insurance')
    expect(step.body).toContain('Admiral')
    expect(step.body).toContain('CAR-991')
  })

  it('car: honest no-policy-on-file line when no car policy exists', async () => {
    const { app } = await buildApp(BASE_PROFILE)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'car' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_car_insurance')
    expect(step.body).toMatch(/don't have a car insurance policy on file/i)
  })

  it('medical: names real health cover and income protection', async () => {
    const profile = {
      ...BASE_PROFILE,
      policies: [{ type: 'health', provider: 'Bupa', coverage_amount_minor: 3_000_000, monthly_premium_minor: 2500 }],
    }
    const { app } = await buildApp(profile)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'medical' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_health_cover')
    expect(step.body).toContain('Bupa')
    expect(step.body).toContain('income protection')
  })

  it('property: names the home insurer and flags the outstanding mortgage', async () => {
    const profile = {
      ...BASE_PROFILE,
      policies: [{ type: 'home', provider: 'Aviva', coverage_amount_minor: 30_000_000, monthly_premium_minor: 4000 }],
    }
    const { app } = await buildApp(profile)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'property' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_home_cover')
    expect(step.body).toContain('Aviva')
    expect(step.body).toContain('mortgage')
  })

  it('travel: honest about untracked travel insurance, points at the real health policy', async () => {
    const profile = {
      ...BASE_PROFILE,
      policies: [{ type: 'health', provider: 'Bupa', coverage_amount_minor: 3_000_000, monthly_premium_minor: 2500 }],
    }
    const { app } = await buildApp(profile)
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'travel' } })
    const step = res.json().playbook.steps.find((s: { id: string }) => s.id === 'check_travel_cover')
    expect(step.body).toMatch(/don't track travel insurance/i)
    expect(step.body).toContain('Bupa')
  })
})

describe('PRD-108: GET /family/life-events', () => {
  beforeEach(() => {
    signalsStore = []
  })

  it('lists previously reported events, most recent first, each with a freshly rendered playbook', async () => {
    const { app } = await buildApp()
    await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })
    await new Promise((r) => setTimeout(r, 2))
    await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'bereavement' } })

    const res = await app.inject({ method: 'GET', url: '/family/life-events' })
    const events = res.json().events
    expect(events).toHaveLength(2)
    expect(events[0].event_type).toBe('bereavement')
    expect(events[1].event_type).toBe('job_loss')
    expect(events[0].playbook.steps.length).toBeGreaterThan(0)
  })
})

describe('PRD-108: POST /family/life-events/:id/steps/:stepId/prepare', () => {
  beforeEach(() => {
    signalsStore = []
    llmMock.mockClear()
    llmMock.mockImplementation(async (_system: string, prompt: string) => `Draft based on: ${prompt}`)
  })

  it('generates a draft grounded in the step\'s own rendered text for a contact-eligible step', async () => {
    const profile = {
      ...BASE_PROFILE,
      policies: [{ type: 'life', provider: 'Aviva', coverage_amount_minor: 10_000_000, monthly_premium_minor: 2000 }],
    }
    const { app } = await buildApp(profile)
    const reportRes = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'bereavement' } })
    const id = reportRes.json().id

    const res = await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/notify_insurers/prepare` })
    expect(res.statusCode).toBe(200)
    expect(res.json().draft.content).toContain('Aviva')
  })

  it('404s for a step that exists but is not contact-eligible', async () => {
    const { app } = await buildApp()
    const reportRes = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })
    const id = reportRes.json().id

    const res = await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/runway/prepare` })
    expect(res.statusCode).toBe(404)
  })

  it('404s for a non-existent life event id', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/family/life-events/does-not-exist/steps/notify_insurers/prepare' })
    expect(res.statusCode).toBe(404)
  })

  it('degrades gracefully (200, draft: null) when the LLM call fails', async () => {
    llmMock.mockImplementation(async () => { throw new Error('ANTHROPIC_API_KEY not set') })
    const { app } = await buildApp()
    const reportRes = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'bereavement' } })
    const id = reportRes.json().id

    const res = await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/notify_insurers/prepare` })
    expect(res.statusCode).toBe(200)
    expect(res.json().draft).toBeNull()
  })

  it('guardrail: PRD-111 nudge code never names a product/provider or guesses the specific event — CLAUDE.md\'s second rule, mechanically enforced', () => {
    const routeSource = readFileSync(new URL('../life-events.ts', import.meta.url), 'utf-8')
    const detectSource = readFileSync(new URL('../../life-events/detect-unreported-change.ts', import.meta.url), 'utf-8')
    // The reason codes themselves are fine (audit-log-only, server-internal)
    // — what must never appear is a user-facing string guessing the event
    // ("job loss", "lost your") or naming a product/provider/policy.
    const forbidden = /lost your job|you'?ve been made redundant|switch to|compare quotes|best policy|recommended policy/i
    for (const source of [routeSource, detectSource]) {
      expect(source).not.toMatch(forbidden)
    }
  })

  it('guardrail: life-events.ts and render-playbook.ts never import SendGrid or read its API key', () => {
    const routeSource = readFileSync(new URL('../life-events.ts', import.meta.url), 'utf-8')
    const renderSource = readFileSync(new URL('../../life-events/render-playbook.ts', import.meta.url), 'utf-8')
    for (const source of [routeSource, renderSource]) {
      expect(source).not.toMatch(/from\s+['"]@sendgrid\/mail['"]/)
      expect(source).not.toMatch(/process\.env(\.SENDGRID_API_KEY|\[['"]SENDGRID_API_KEY['"]\])/)
    }
  })
})

describe('Remediation item 19: POST /family/life-events/:id/steps/:stepId/complete', () => {
  beforeEach(() => {
    signalsStore = []
    llmMock.mockClear()
  })

  const reportEvent = async (app: any): Promise<string> => {
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })
    return res.json().id
  }

  it('persists a completed step and returns it in subsequent GETs', async () => {
    const { app } = await buildApp()
    const id = await reportEvent(app)

    const res = await app.inject({
      method: 'POST',
      url: `/family/life-events/${id}/steps/runway/complete`,
      payload: { done: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed_step_ids).toEqual(['runway'])

    const get = await app.inject({ method: 'GET', url: '/family/life-events' })
    const event = get.json().events.find((e: any) => e.id === id)
    expect(event.completed_step_ids).toEqual(['runway'])
  })

  it('is idempotent — marking the same step done twice never duplicates it', async () => {
    const { app } = await buildApp()
    const id = await reportEvent(app)

    await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/runway/complete`, payload: { done: true } })
    const second = await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/runway/complete`, payload: { done: true } })
    expect(second.json().completed_step_ids).toEqual(['runway'])
    expect(signalsStore.find((s) => s.id === id)?.data['completed_step_ids']).toEqual(['runway'])
  })

  it('done:false removes a previously-completed step (cross-device converge-on-value, not a blind toggle)', async () => {
    const { app } = await buildApp()
    const id = await reportEvent(app)

    await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/runway/complete`, payload: { done: true } })
    const res = await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/runway/complete`, payload: { done: false } })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed_step_ids).toEqual([])
  })

  it('404s for a step id the rendered playbook does not contain', async () => {
    const { app } = await buildApp()
    const id = await reportEvent(app)
    const res = await app.inject({
      method: 'POST',
      url: `/family/life-events/${id}/steps/not_a_real_step/complete`,
      payload: { done: true },
    })
    expect(res.statusCode).toBe(404)
  })

  it('404s for a non-existent life event id', async () => {
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/life-events/does-not-exist/steps/runway/complete',
      payload: { done: true },
    })
    expect(res.statusCode).toBe(404)
  })

  it('400s when "done" is missing or not a boolean', async () => {
    const { app } = await buildApp()
    const id = await reportEvent(app)

    const missing = await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/runway/complete`, payload: {} })
    expect(missing.statusCode).toBe(400)

    const wrongType = await app.inject({ method: 'POST', url: `/family/life-events/${id}/steps/runway/complete`, payload: { done: 'yes' } })
    expect(wrongType.statusCode).toBe(400)
  })

  it('filters stored ids that no longer exist in the rendered playbook out of reads', async () => {
    const { app } = await buildApp()
    const id = await reportEvent(app)
    signalsStore.find((s) => s.id === id)!.data['completed_step_ids'] = ['runway', 'stale_step_from_old_playbook']

    const get = await app.inject({ method: 'GET', url: '/family/life-events' })
    const event = get.json().events.find((e: any) => e.id === id)
    expect(event.completed_step_ids).toEqual(['runway'])
  })
})

describe('PRD-111: GET /family/life-events/nudge and POST /nudge/dismiss', () => {
  beforeEach(() => {
    signalsStore = []
  })

  it('reports inactive when no nudge state exists for the tenant', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/family/life-events/nudge' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ active: false })
  })

  it('reports active once a nudge is flagged, and never returns a reason', async () => {
    const { app } = await buildApp()
    nudgeStateStore.push({ tenant_id: TENANT, active: true, reason: 'employment_status_change', triggered_at: new Date() })

    const res = await app.inject({ method: 'GET', url: '/family/life-events/nudge' })
    expect(res.json()).toEqual({ active: true })
    expect(JSON.stringify(res.json())).not.toContain('employment_status_change')
  })

  it('dismiss clears an active nudge', async () => {
    const { app } = await buildApp()
    nudgeStateStore.push({ tenant_id: TENANT, active: true, reason: 'salary_to_zero' })

    const dismiss = await app.inject({ method: 'POST', url: '/family/life-events/nudge/dismiss' })
    expect(dismiss.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/family/life-events/nudge' })
    expect(get.json()).toEqual({ active: false })
  })

  it('reporting a life event while a nudge is active clears it automatically', async () => {
    const { app } = await buildApp()
    nudgeStateStore.push({ tenant_id: TENANT, active: true, reason: 'emergency_fund_drained' })

    await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })

    const get = await app.inject({ method: 'GET', url: '/family/life-events/nudge' })
    expect(get.json()).toEqual({ active: false })
  })

  it('reporting a life event with no active nudge is a no-op, not an error', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })
    expect(res.statusCode).toBe(201)
  })
})
