/**
 * GET /family/resilience — the income-stops runway range for the household (intent 94, Tier 0, read-only).
 * Adults in the family see it (A5); every other caller gets a 403 and no figures.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyResilienceRoutes } from '../family-resilience.js'
import { ratesVersion } from '../../resilience/event-rates.js'

const TENANT = 't-resilience'
let profile: Record<string, unknown> | null
let family: Record<string, unknown> | null

let facts: Record<string, unknown>[] = []
let metricEvents: Record<string, unknown>[] = []
let metricsWritesFail = false
const indexes: unknown[] = []
const col = (store: Record<string, unknown>[]) => ({
  createIndex: async (spec: unknown) => {
    indexes.push(spec)
    return ''
  },
  findOne: async () => store[0] ?? null,
  find: (filter: Record<string, unknown> = {}) => ({
    toArray: async () => store.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)),
  }),
  insertOne: async (doc: Record<string, unknown>) => {
    store.push(doc)
    return {}
  },
})
const makeDb = () =>
  ({
    collection: (name: string) =>
      name === 'family_financial_profile'
        ? col(profile ? [profile] : [])
        : name === 'family_groups'
          ? col(family ? [family] : [])
          : name === 'engine_facts'
            ? col(facts)
            : name === 'engine_metrics_events'
              ? metricsWritesFail
                ? {
                    insertOne: async () => {
                      throw new Error('metrics store down')
                    },
                  }
                : col(metricEvents)
              : col([]),
  }) as never

async function appFor(user_id: string) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = {
      tenant_id: TENANT,
      user_id,
      roles: ['member'],
    }
  })
  registerFamilyResilienceRoutes(app, makeDb())
  return app
}

const fullProfile = (over: Record<string, unknown> = {}) => ({
  tenant_id: TENANT,
  household: {
    monthly_salary_minor: 300_000,
    income_protection_monthly_minor: 0,
    ...over,
  },
  emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
})

beforeEach(() => {
  facts = []
  metricEvents = []
  metricsWritesFail = false
  profile = fullProfile()
  family = {
    tenant_id: TENANT,
    members: [
      { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
      { id: 'u2', name: 'Sam', role: 'adult', status: 'active' },
      { id: 'kid', name: 'Kit', role: 'child', status: 'active' },
      { id: 'p', name: 'Pat', role: 'adult', status: 'pending' },
    ],
  }
})

describe('GET /family/resilience', () => {
  it('shows an adult the estimate: 3 months from savings alone, always labelled an estimate', async () => {
    const res = await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ready')
    expect(body.range).toEqual({ lowMonths: 3, highMonths: 3 })
    expect(body.text).toMatch(/estimate/)
    expect(body.left_out).toContain('tax and benefits')
    expect(body.next_checks.at(-1)).toBe(
      'Ask a licensed professional what applies to your household',
    )
  })

  it('counts income protection on file against the spend', async () => {
    profile = fullProfile({ income_protection_monthly_minor: 150_000 })
    const body = (
      await (await appFor('u2')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.range.lowMonths).toBe(6)
  })

  it('reports open ended cover as null, never the internal sentinel', async () => {
    profile = fullProfile({ income_protection_monthly_minor: 300_000 })
    const body = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.range).toEqual({ lowMonths: null, highMonths: null })
    expect(JSON.stringify(body)).not.toContain('9999')
  })

  it.each([['kid'], ['p'], ['stranger']])('refuses %s with a 403 and no figures', async (who) => {
    const res = await (await appFor(who)).inject({ method: 'GET', url: '/family/resilience' })
    expect(res.statusCode).toBe(403)
    expect(res.body).not.toMatch(/\d{4,}/)
  })

  it('lists what is missing instead of guessing', async () => {
    profile = { tenant_id: TENANT, household: {}, emergency_fund: {} }
    const body = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.status).toBe('needs_figures')
    expect(body.missing).toEqual(['savings', 'monthly spend', 'monthly income'])
    expect(body.range).toBeUndefined()
  })

  it('answers needs_figures when there is no profile at all', async () => {
    profile = null
    const body = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.status).toBe('needs_figures')
  })

  // Intent 97, slice 6: an estimate says which population rates it carries,
  // so a rate change is a new version an estimate can be traced to.
  it('reports the rates version of the rate set it carries', async () => {
    const body = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.status).toBe('ready')
    expect(body.rates_version).toBe(ratesVersion())
    // needs_figures carries no estimate, so no rates version either.
    profile = null
    const none = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(none.rates_version).toBeUndefined()
  })
})

describe('confirming the figures (both adults)', () => {
  const post = async (who: string) =>
    (await appFor(who)).inject({ method: 'POST', url: '/family/resilience/confirm' })
  const get = async (who: string) =>
    (await (await appFor(who)).inject({ method: 'GET', url: '/family/resilience' })).json()

  it('lists the figures used and starts with nobody confirmed', async () => {
    const body = await get('u1')
    expect(body.figures).toEqual([
      { label: 'Savings', valueMinor: 900_000, key: 'savings_minor' },
      { label: 'Monthly spend', valueMinor: 300_000, key: 'monthly_spend_minor' },
      { label: 'Monthly income', valueMinor: 300_000, key: 'monthly_inflow_minor' },
      {
        label: 'Income protection per month',
        valueMinor: 0,
        key: 'income_protection_monthly_minor',
      },
    ])
    expect(body.confirmation).toMatchObject({
      confirmedBy: [],
      youConfirmed: false,
      allAdultsConfirmed: false,
      adultsTotal: 2,
    })
  })

  it('records one adult, then both, as facts with confirmed_at', async () => {
    expect((await post('u1')).statusCode).toBe(200)
    expect((await get('u1')).confirmation).toMatchObject({
      confirmedBy: ['Alex'],
      youConfirmed: true,
      allAdultsConfirmed: false,
    })
    expect((await get('u2')).confirmation.youConfirmed).toBe(false)
    await post('u2')
    const c = (await get('u2')).confirmation
    expect(c.allAdultsConfirmed).toBe(true)
    expect(facts.length).toBe(8)
    expect(facts.every((f) => f['confirmed_at'] instanceof Date && f['tenant_id'] === TENANT)).toBe(
      true,
    )
  })

  it('confirming twice writes nothing more', async () => {
    await post('u1')
    await post('u1')
    expect(facts.length).toBe(4)
  })

  it('a changed figure is a new version, so earlier confirmations no longer count', async () => {
    await post('u1')
    await post('u2')
    profile = fullProfile()
    ;(
      profile as { emergency_fund: { emergency_savings_minor: number } }
    ).emergency_fund.emergency_savings_minor = 950_000
    const c = (await get('u1')).confirmation
    expect(c).toMatchObject({ confirmedBy: [], youConfirmed: false, allAdultsConfirmed: false })
  })

  it('a child or outsider cannot confirm, and nothing is written', async () => {
    expect((await post('kid')).statusCode).toBe(403)
    expect((await post('stranger')).statusCode).toBe(403)
    expect(facts.length).toBe(0)
  })

  it('refuses to confirm when figures are missing', async () => {
    profile = { tenant_id: TENANT, household: {}, emergency_fund: {} }
    expect((await post('u1')).statusCode).toBe(400)
    expect(facts.length).toBe(0)
  })
})

describe('engine metrics on confirmation (intent 97, slice 1)', () => {
  const post = async (who: string) =>
    (await appFor(who)).inject({ method: 'POST', url: '/family/resilience/confirm' })
  const events = (name: string) => metricEvents.filter((e) => e['event'] === name)

  it('one adult confirming writes exactly one one-adult event and nothing else', async () => {
    expect((await post('u1')).statusCode).toBe(200)
    expect(events('figures_confirmed_one_adult')).toHaveLength(1)
    expect(events('figures_confirmed_all_adults')).toHaveLength(0)
    expect(events('figures_confirm_latency')).toHaveLength(0)
    expect(metricEvents.every((e) => e['tenant_id'] === TENANT)).toBe(true)
    // The event carries an outcome and a date — never a figure or a name.
    expect(JSON.stringify(metricEvents)).not.toMatch(/900|300|Alex|Sam/)
  })

  it('the last adult confirming writes one one-adult, one all-adults and one bucketed latency event', async () => {
    await post('u1')
    await post('u2')
    expect(events('figures_confirmed_one_adult')).toHaveLength(2)
    expect(events('figures_confirmed_all_adults')).toHaveLength(1)
    const latency = events('figures_confirm_latency')
    expect(latency).toHaveLength(1)
    expect(latency[0]!['bucket']).toMatch(/^(lt_1h|1h_1d|1d_7d|7d_plus)$/)
  })

  it('confirming again writes no further events', async () => {
    await post('u1')
    await post('u2')
    metricEvents = []
    await post('u1')
    await post('u2')
    expect(metricEvents).toHaveLength(0)
  })

  it('a metrics write failure never fails the confirm request', async () => {
    metricsWritesFail = true
    expect((await post('u1')).statusCode).toBe(200)
    expect(facts.length).toBe(4)
  })
})

describe('engine_facts index', () => {
  it('is created on tenant and version at registration', async () => {
    indexes.length = 0
    await appFor('u1')
    expect(indexes).toContainEqual({ tenant_id: 1, figures_version: 1 })
  })
})

describe('if the main earner dies', () => {
  const body = async (who = 'u1') =>
    (await (await appFor(who)).inject({ method: 'GET', url: '/family/resilience' })).json()

  it('is left out when no life cover is entered', async () => {
    expect((await body()).earner_dies).toBeUndefined()
  })

  it('shows a range because the payout timing is 1 to 2 months', async () => {
    profile = fullProfile({ life_cover_minor: 1_200_000 })
    ;(
      profile as { emergency_fund: { emergency_savings_minor: number } }
    ).emergency_fund.emergency_savings_minor = 450_000
    const d = (await body()).earner_dies
    expect(d.range).toEqual({ lowMonths: 1, highMonths: 5 })
    expect(d.text).toMatch(/^Savings and the cover payout would cover 1 to 5 months/)
    expect(d.assumptions.join(' ')).toMatch(/1 to 2 months/)
    expect(d.assumptions.join(' ')).toMatch(/main earner/)
  })

  it('adds the payout timing check to the next checks, before the closing line', async () => {
    profile = fullProfile({ life_cover_minor: 1_200_000 })
    ;(
      profile as { emergency_fund: { emergency_savings_minor: number } }
    ).emergency_fund.emergency_savings_minor = 450_000
    const checks: string[] = (await body()).next_checks
    expect(checks.some((c) => /how long the cover takes to pay out/.test(c))).toBe(true)
    expect(checks.at(-1)).toMatch(/licensed professional/)
  })

  it('the life cover amount is one of the figures confirmed, so changing it needs confirming again', async () => {
    profile = fullProfile({ life_cover_minor: 1_200_000 })
    expect((await body()).figures.map((f: { label: string }) => f.label)).toContain(
      'Life cover amount',
    )
    await (await appFor('u1')).inject({ method: 'POST', url: '/family/resilience/confirm' })
    expect((await body()).confirmation.youConfirmed).toBe(true)
    profile = fullProfile({ life_cover_minor: 1_000_000 })
    expect((await body()).confirmation.youConfirmed).toBe(false)
  })

  it('changing life cover leaves the income-stops estimate confirmed; only earner-dies needs it again', async () => {
    profile = fullProfile({ life_cover_minor: 1_200_000 })
    await (await appFor('u1')).inject({ method: 'POST', url: '/family/resilience/confirm' })
    const before = (await body()).scenarios
    expect(before.income_stops.youConfirmed).toBe(true)
    expect(before.earner_dies.youConfirmed).toBe(true)
    profile = fullProfile({ life_cover_minor: 1_000_000 })
    const after = (await body()).scenarios
    expect(after.income_stops.youConfirmed).toBe(true)
    expect(after.earner_dies.youConfirmed).toBe(false)
  })

  it('without life cover there is only the income-stops estimate to confirm', async () => {
    await (await appFor('u1')).inject({ method: 'POST', url: '/family/resilience/confirm' })
    const s = (await body()).scenarios
    expect(Object.keys(s)).toEqual(['income_stops'])
    expect(s.income_stops.youConfirmed).toBe(true)
  })
})

describe('what the profile does not hold', () => {
  const view = async () =>
    (await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })).json()

  it('names income protection and life cover as not on file, as plain facts', async () => {
    const body = await view()
    expect(body.not_on_file).toEqual([
      'No income protection payout is recorded in your profile.',
      'No life cover amount is recorded in your profile, so there is no estimate for if the main earner dies.',
    ])
    expect(body.not_on_file.join(' ')).not.toMatch(/\b(buy|should|need to|get a|switch|best)\b/i)
  })

  it('lists nothing once both are on file', async () => {
    profile = fullProfile({ income_protection_monthly_minor: 100_000, life_cover_minor: 5_000_000 })
    expect((await view()).not_on_file).toEqual([])
  })
})

describe('GET /family/resilience/history (what each adult confirmed, and when)', () => {
  const post = async (who: string) =>
    (await appFor(who)).inject({ method: 'POST', url: '/family/resilience/confirm' })
  const history = async (who: string) =>
    (await appFor(who)).inject({ method: 'GET', url: '/family/resilience/history' })

  it('is empty before anyone has confirmed', async () => {
    const res = await history('u1')
    expect(res.statusCode).toBe(200)
    expect(res.json().entries).toEqual([])
  })

  it('lists who confirmed which figures and when, newest first, marking the current ones', async () => {
    await post('u1')
    await post('u2')
    const { entries } = (await history('u1')).json()
    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e.scenario).toBe('income_stops')
    expect(e.current).toBe(true)
    expect(e.confirmedBy.map((c: { name: string }) => c.name).sort()).toEqual(['Alex', 'Sam'])
    expect(typeof e.confirmedBy[0].at).toBe('string')
    expect(e.figures).toContainEqual({ label: 'Savings', valueMinor: 900_000 })
  })

  it('keeps the old confirmation after a figure changes, no longer marked current', async () => {
    await post('u1')
    await post('u2')
    ;(
      profile as { emergency_fund: { emergency_savings_minor: number } }
    ).emergency_fund.emergency_savings_minor = 950_000
    await post('u1')
    const { entries } = (await history('u1')).json()
    expect(entries).toHaveLength(2)
    expect(entries.map((e: { current: boolean }) => e.current)).toEqual([true, false])
    expect(entries[1].figures).toContainEqual({ label: 'Savings', valueMinor: 900_000 })
    expect(entries[0].confirmedBy.map((c: { name: string }) => c.name)).toEqual(['Alex'])
  })

  it('a child or outsider gets a 403 and no figures', async () => {
    await post('u1')
    for (const who of ['kid', 'stranger']) {
      const res = await history(who)
      expect(res.statusCode).toBe(403)
      expect(res.body).not.toContain('900000')
    }
  })
})
