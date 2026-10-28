/**
 * PRD-222 household briefs — the Stage 1 product promise.
 *
 * The tests that matter most:
 *  - a plain GET (what WhatsApp/iMessage scanners do) sets link_fetched_at
 *    but can NEVER set confirmed_opened_at;
 *  - the creator confirming their own link records self, not a confirmed
 *    open by the other adult;
 *  - revoked -> 410, expired -> 404, and the result endpoint is never
 *    cached (private, no-store);
 *  - the second brief hits brief_gate (402) unless the tenant is entitled;
 *  - template_sentence only contains numerals from the solver payload
 *    (Intent 65 invariant applied to the template itself);
 *  - a profile write marks briefs stale (change-driven invalidation) and
 *    the next read recomputes once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerFamilyBriefRoutes } from '../family-briefs.js'
import {
  briefsFor,
  markBriefsStale,
  narrateBrief,
  solveBrief,
  tokenHash,
  type BriefInputs,
  type BriefProblemType,
  type HouseholdBriefDoc,
} from '../../briefs/briefs.js'

const TENANT = 't-briefs'
const CREATOR = 'user-creator'
const PARTNER = 'user-partner'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
/** Swappable per request — simulates the creator vs the partner/anon. */
let currentUser: string | null = CREATOR
let currentRoles: string[] = ['admin']

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('family-briefs-test')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (currentUser) {
      ;(request as unknown as Record<string, unknown>)['authContext'] = {
        tenant_id: TENANT,
        user_id: currentUser,
        roles: currentRoles,
      }
    }
  })
  registerFamilyBriefRoutes(app, db)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  currentUser = CREATOR
  currentRoles = ['admin']
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).deleteMany({})
  }
})

const INCOME_INPUTS = {
  monthly_income_minor: 300_000,
  monthly_essentials_minor: 200_000,
  liquid_savings_minor: 600_000,
}

async function createBrief(problem = 'income_stops', inputs: BriefInputs = INCOME_INPUTS) {
  const res = await app.inject({
    method: 'POST',
    url: '/family/briefs',
    payload: { problem_type: problem, inputs, for_member_id: PARTNER },
  })
  return res
}

describe('POST /family/briefs', () => {
  it('solves once, stores the versioned result, mints a hashed share token', async () => {
    const res = await createBrief()
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.brief.problem_type).toBe('income_stops')
    expect(body.brief.result.projectedRunwayMonths).toBe(3)
    expect(body.brief.solver_version).toBe('brief-v1')
    expect(typeof body.brief.data_version).toBe('string')
    expect(body.brief.share.url).toMatch(/^[0-9a-f]{48}$/)
    // Only the hash is stored — never the raw token.
    const doc = await briefsFor(db, TENANT).findOne({ id: body.brief.id })
    expect(doc!.share!.token_hash).toBe(tokenHash(body.brief.share.url))
    expect(JSON.stringify(doc!.share)).not.toContain(body.brief.share.url)
    // Funnel events recorded.
    expect(await db.collection('growth_events').countDocuments({ event: 'brief_created' })).toBe(1)
    expect(
      await db.collection('growth_events').countDocuments({
        event: 'brief_share_link_generated',
      }),
    ).toBe(1)
  })

  it('the first brief is free; the second hits the 402 brief gate', async () => {
    expect((await createBrief()).statusCode).toBe(201)
    const res = await createBrief()
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toBe('brief_gate')
    expect(res.json().required_entitlement).toBe('household_record')
    expect(await db.collection('growth_events').countDocuments({ event: 'brief_gate_hit' })).toBe(1)
  })

  it('a paid/entitled tenant can create a second brief', async () => {
    expect((await createBrief()).statusCode).toBe(201)
    await db.collection('tenants').insertOne({ tenant_id: TENANT, plan: 'plus' })
    const res = await createBrief('earning_less', {
      ...INCOME_INPUTS,
      new_income_minor: 150_000,
      months_until_change: 6,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().brief.problem_type).toBe('earning_less')
  })

  it('rejects bad inputs and non-editor roles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: { problem_type: 'nonsense', inputs: {} },
    })
    expect(res.statusCode).toBe(400)
    currentUser = null
    const res2 = await app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: { problem_type: 'income_stops', inputs: INCOME_INPUTS },
    })
    expect(res2.statusCode).toBe(401) // no session → clean 401, not a 500

    // A session without an editor role is a 403 (child or read-only adult).
    await db.collection('family_groups').insertOne({
      tenant_id: TENANT,
      members: [{ user_id: 'user-viewer', name: 'Vik', role: 'adult', status: 'active' }],
    })
    currentUser = 'user-viewer'
    currentRoles = ['viewer']
    const res3 = await app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: { problem_type: 'income_stops', inputs: INCOME_INPUTS },
    })
    expect(res3.statusCode).toBe(403)
  })
})

describe('GET /b/:token — fetched is not opened', () => {
  it('serves the stored result with no-store; GET never stamps confirmed_opened_at', async () => {
    const res = await createBrief()
    const token = res.json().brief.share.url
    currentUser = null // anonymous opener, like a scanner

    const view = await app.inject({ method: 'GET', url: `/b/${token}` })
    expect(view.statusCode).toBe(200)
    expect(view.headers['cache-control']).toContain('no-store')
    const v = view.json()
    expect(v.result.projectedRunwayMonths).toBe(3)
    expect(v.template_sentence).toContain('months')
    expect(v.confirmed_opened_at).toBeNull()

    const doc = await db.collection('household_briefs').findOne({ id: res.json().brief.id })
    // A scanner GET stamps the telemetry timestamp but not the promise.
    expect(doc!.link_fetched_at).not.toBeNull()
    expect(doc!.confirmed_opened_at).toBeNull()
  })

  it('explicit confirm stamps confirmed_opened_at; creator self-open does not', async () => {
    const res = await createBrief()
    const briefId = res.json().brief.id
    const token = res.json().brief.share.url

    // Creator opening their own link → recorded as self, promise stays null.
    currentUser = CREATOR
    const self = await app.inject({ method: 'POST', url: `/b/${token}/confirm`, payload: {} })
    expect(self.json().confirmed).toBe(false)
    let doc = await db.collection('household_briefs').findOne<HouseholdBriefDoc>({ id: briefId })
    expect(doc!.confirmed_opened_at).toBeNull()

    // The partner (a different session, or anonymous) → confirmed open.
    currentUser = PARTNER
    const conf = await app.inject({ method: 'POST', url: `/b/${token}/confirm`, payload: {} })
    expect(conf.json().confirmed).toBe(true)
    expect(conf.json().confirmed_opened_at).not.toBeNull()
    doc = await db.collection('household_briefs').findOne<HouseholdBriefDoc>({ id: briefId })
    expect(doc!.confirmed_opened_at).not.toBeNull()
    expect(doc!.confirmed_by).toBe(PARTNER)
    expect(
      await db.collection('growth_events').countDocuments({ event: 'brief_confirmed_open' }),
    ).toBe(1)
  })

  it('revoked link returns 410; expired returns 404', async () => {
    const res = await createBrief()
    const { id } = res.json().brief
    const token = res.json().brief.share.url

    await app.inject({ method: 'POST', url: `/family/briefs/${id}/revoke`, payload: {} })
    const gone = await app.inject({ method: 'GET', url: `/b/${token}` })
    expect(gone.statusCode).toBe(410)

    // Re-mint then backdate expiry past now → 404.
    await app.inject({ method: 'POST', url: `/family/briefs/${id}/share`, payload: {} })
    await db
      .collection('household_briefs')
      .updateOne({ id }, { $set: { 'share.expires_at': new Date(Date.now() - 1000) } })
    const expired = await app.inject({ method: 'GET', url: `/b/${token}` })
    expect(expired.statusCode).toBe(404)
  })
})

describe('staleness + template invariant', () => {
  it('profile write marks briefs stale; next read recomputes once', async () => {
    const res = await createBrief()
    const id = res.json().brief.id
    await markBriefsStale(db, TENANT)
    let doc = await briefsFor(db, TENANT).findOne({ id })
    expect(doc!.stale).toBe(true)

    const view = await app.inject({ method: 'GET', url: `/family/briefs/${id}` })
    expect(view.json().brief.stale).toBe(false)
    doc = await briefsFor(db, TENANT).findOne({ id })
    expect(doc!.stale).toBe(false)
  })

  it('every numeral in the template appears in the solver payload (Intent 65)', () => {
    const cases: Array<[string, typeof INCOME_INPUTS & Record<string, number>]> = [
      ['income_stops', INCOME_INPUTS],
      [
        'income_stops',
        { ...INCOME_INPUTS, income_protection_monthly_minor: 120_000, deferred_period_months: 3 },
      ],
      ['earning_less', { ...INCOME_INPUTS, new_income_minor: 180_000, months_until_change: 4 }],
      ['handover_gap', INCOME_INPUTS],
    ]
    for (const [problem, inputs] of cases) {
      const solved = solveBrief(problem as BriefProblemType, inputs)
      if ('error' in solved) throw new Error(`solveBrief failed for ${problem}: ${solved.error}`)
      const s = solved
      const allowed = new Set<number>()
      const collect = (v: unknown) => {
        if (typeof v === 'number' && Number.isFinite(v)) allowed.add(Math.round(v))
        else if (Array.isArray(v)) v.forEach(collect)
        else if (v && typeof v === 'object') Object.values(v).forEach(collect)
      }
      collect(s.result)
      collect(inputs)
      // Numerals in the sentence (digits + thousands separators + decimals,
      // £-prefixed values compared in pence).
      const digits = s.template_sentence.match(/£?[\d,]+(?:\.\d+)?/g) ?? []
      for (const d of digits) {
        const isMoney = d.startsWith('£')
        const n = Number(d.replace(/[£,]/g, ''))
        const found = isMoney
          ? [...allowed].some((a) => Math.round(a / 100) === n)
          : [...allowed].some((a) => Math.abs(a - n) < 0.15 || Math.round(a / 100) === n)
        expect(found, `numeral "${d}" not in solver payload for ${problem}`).toBe(true)
      }
    }
  })
})

describe('brief.narrate — governed, guarded, cached', () => {
  async function freshBrief() {
    const res = await createBrief()
    return briefsFor(db, TENANT).findOne({ id: res.json().brief.id }) as Promise<HouseholdBriefDoc>
  }
  const llm = (text: string) => async () => text
  const throwing = async () => {
    throw new Error('no provider')
  }

  it('a grounded narration is stored and returned', async () => {
    const b = await freshBrief()
    const out = await narrateBrief(
      db,
      b,
      llm('If income stopped, £6,000 would cover £2,000 a month for about 3.0 months.'),
    )
    expect(out.narrated).toBe(true)
    const doc = await briefsFor(db, TENANT).findOne({ id: b.id })
    expect(doc!.narrated_sentence).toContain('£6,000')
    expect(doc!.narrated_solver_version).toBe(b.solver_version)
  })

  it('rejects any numeral absent from the solver payload and falls back to the template', async () => {
    const b = await freshBrief()
    const out = await narrateBrief(db, b, llm('Your savings would last about 42 months.'))
    expect(out.narrated).toBe(false)
    expect(out.sentence).toBe(b.template_sentence)
    const doc = await briefsFor(db, TENANT).findOne({ id: b.id })
    expect(doc!.narrated_sentence).toBeNull()
  })

  it('call failure / budget exhausted falls back to the template silently', async () => {
    const b = await freshBrief()
    const out = await narrateBrief(db, b, throwing)
    expect(out.narrated).toBe(false)
    expect(out.sentence).toBe(b.template_sentence)
  })

  it('cache hit on matching solver+data versions returns the stored sentence without a model call', async () => {
    const b = await freshBrief()
    await narrateBrief(
      db,
      b,
      llm('£6,000 covers £2,000 a month for about 3.0 months if income stops.'),
    )
    // Second call: even a throwing model is never reached — versions match.
    const reloaded = (await briefsFor(db, TENANT).findOne({ id: b.id }))!
    const out = await narrateBrief(db, reloaded, throwing)
    expect(out.from_cache).toBe(true)
    expect(out.narrated).toBe(true)
    expect(out.sentence).toContain('£6,000')
  })

  it('POST /family/briefs/:id/narrate with no provider configured falls back to the template', async () => {
    const res = await createBrief()
    const r = await app.inject({
      method: 'POST',
      url: `/family/briefs/${res.json().brief.id}/narrate`,
      payload: {},
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().narrated).toBe(false)
    expect(r.json().sentence).toBe(res.json().brief.template_sentence)
  })
})
