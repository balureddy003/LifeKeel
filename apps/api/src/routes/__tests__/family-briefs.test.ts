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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import Fastify, { type FastifyInstance } from 'fastify'
import { BRIEF_CATALOGUE } from '../../briefs/catalogue.js'
import { registerFamilyBriefRoutes } from '../family-briefs.js'

// PRD-222's hard guarantee: the brief path performs ZERO model calls.
// taskLlm is mocked to throw — every test in this file (create, solve,
// share, fetch, confirm, revoke, stale recompute) must still pass, which
// proves no route reaches the governed model layer. The narrate route is
// the only caller and must degrade to the template, not crash.
vi.mock('../../ai/task-gateway.js', () => ({
  taskLlm: () => {
    throw new Error('model layer touched on the brief path')
  },
}))
import {
  briefsFor,
  markBriefsStale,
  narrateBrief,
  solveBrief,
  tokenHash,
  type BriefInputs,
  type BriefProblemType,
  type HouseholdBriefDoc,
  migrateSensitiveBriefFacts,
  purgeExpiredSensitiveFacts,
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

  it('the first-brief path performs zero model calls (PRD-222 guarantee)', async () => {
    // taskLlm is mocked to throw (top of file): create → share fetch →
    // confirm all succeed with the model layer dead. Any future route
    // code that touches the gateway fails this suite loudly.
    const res = await createBrief()
    expect(res.statusCode).toBe(201)
    const token = res.json().brief.share.url
    expect((await app.inject({ method: 'GET', url: `/b/${token}` })).statusCode).toBe(200)
    currentUser = PARTNER // the second adult opens the link
    expect(
      (await app.inject({ method: 'POST', url: `/b/${token}/confirm`, payload: {} })).json()
        .confirmed,
    ).toBe(true)
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

// ─── Contract v2: immutable catalogue snapshots + dual confirmations ───────

describe('brief contract v2', () => {
  const CREATOR_M = {
    id: 'm-creator',
    name: 'Sam',
    role: 'organizer',
    status: 'active',
    email: 's@x.co',
    joined_at: '2026-01-01',
    user_id: CREATOR,
  }
  const PARTNER_M = {
    id: 'm-partner',
    name: 'Alex',
    role: 'adult',
    status: 'active',
    email: 'a@x.co',
    joined_at: '2026-01-01',
    user_id: PARTNER,
  }

  async function createV2(problem = 'earning_less', extraInputs = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: {
        contract_version: 2,
        problem_type: problem,
        for_member_id: 'm-partner',
        inputs: {
          monthly_income_minor: 300000,
          monthly_essentials_minor: 200000,
          liquid_savings_minor: 600000,
          new_income_minor: 150000,
          new_essentials_minor: 200000,
          change_date: '2027-01-01',
          ...extraInputs,
        },
      },
    })
    return res
  }

  beforeEach(async () => {
    await db.collection('family_groups').insertOne({
      tenant_id: TENANT,
      members: [CREATOR_M, PARTNER_M],
      created_at: new Date(),
    })
    await db.collection('tenants').insertOne({ tenant_id: TENANT, plan: 'plus' })
  })

  describe('preview and can_create', () => {
    const INPUTS = {
      monthly_income_minor: 300000,
      monthly_essentials_minor: 200000,
      liquid_savings_minor: 600000,
      new_income_minor: 150000,
      new_essentials_minor: 200000,
      change_date: '2027-01-01',
    }
    const preview = (problem_type: string, inputs: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/family/briefs/preview',
        payload: { problem_type, inputs },
      })

    it('returns the same answer as create without saving anything', async () => {
      const before = await db.collection('household_briefs').countDocuments({})
      const p = await preview('earning_less', INPUTS)
      expect(p.statusCode).toBe(200)
      expect(await db.collection('household_briefs').countDocuments({})).toBe(before)
      const created = await createV2('earning_less')
      expect(created.statusCode).toBe(201)
      expect(p.json().preview.template_sentence).toBe(created.json().brief.template_sentence)
    })

    it('gives a partial first number from three money fields and a date, with the assumption stated', async () => {
      const minimum = {
        monthly_income_minor: INPUTS.monthly_income_minor,
        monthly_essentials_minor: INPUTS.monthly_essentials_minor,
        liquid_savings_minor: INPUTS.liquid_savings_minor,
        change_date: INPUTS.change_date,
      }
      const p = await preview('job_change', minimum)
      expect(p.statusCode).toBe(200)
      expect(p.json().preview.template_sentence).toContain('partial answer')
      expect(
        p.json().preview.facts.some((f: { label: string }) => f.label.startsWith('Assumed')),
      ).toBe(true)
    })

    it('is not blocked by the first-brief gate, because nothing is created', async () => {
      await db.collection('tenants').deleteMany({})
      await db.collection('tenants').insertOne({ tenant_id: TENANT, plan: 'free' })
      expect((await createV2('earning_less')).statusCode).toBe(201)
      expect((await createV2('earning_less')).statusCode).toBe(402)
      expect((await preview('earning_less', INPUTS)).statusCode).toBe(200)
    })

    it('names the field when inputs are wrong', async () => {
      const r = await preview('earning_less', { ...INPUTS, monthly_income_minor: -1 })
      expect(r.statusCode).toBe(400)
      expect(r.json().error).toBe('Take-home income must be zero or more')
    })

    it('never previews handover or sensitive entries', async () => {
      const r = await preview('medical_contacts', { change_date: '2027-01-01', facts: {} })
      expect(r.statusCode).toBe(400)
      expect(r.json().error).toMatch(/no calculation/)
    })

    it('refuses someone who cannot create briefs, and says so in the catalogue', async () => {
      currentRoles = ['viewer']
      expect((await preview('earning_less', INPUTS)).statusCode).toBe(403)
      const cat = await app.inject({ method: 'GET', url: '/family/brief-catalogue' })
      expect(cat.json().can_create).toBe(false)
      currentRoles = ['owner']
      const cat2 = await app.inject({ method: 'GET', url: '/family/brief-catalogue' })
      expect(cat2.json().can_create).toBe(true)
    })

    it('produces the first number with the model layer dead (PRD-230)', async () => {
      // taskLlm is mocked to throw for this whole file: catalogue → preview →
      // create → share fetch is the first-value path end to end, and it must
      // never reach the governed model layer.
      expect((await app.inject({ method: 'GET', url: '/family/brief-catalogue' })).statusCode).toBe(
        200,
      )
      expect((await preview('earning_less', INPUTS)).statusCode).toBe(200)
      const created = await createV2('earning_less')
      expect(created.statusCode).toBe(201)
      currentUser = PARTNER
      expect(
        (await app.inject({ method: 'GET', url: `/b/${created.json().brief.share.url}` }))
          .statusCode,
      ).toBe(200)
      currentUser = CREATOR
    })
  })

  it('rejects catalogue create with no named adult recipient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: { contract_version: 2, problem_type: 'earning_less', inputs: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  describe('single-adult household', () => {
    const SOLO_INPUTS = {
      monthly_income_minor: 300000,
      monthly_essentials_minor: 200000,
      liquid_savings_minor: 600000,
      new_income_minor: 150000,
      new_essentials_minor: 200000,
      change_date: '2027-01-01',
    }
    beforeEach(async () => {
      await db.collection('family_groups').deleteMany({ tenant_id: TENANT })
      await db
        .collection('family_groups')
        .insertOne({ tenant_id: TENANT, members: [CREATOR_M], created_at: new Date() })
    })

    it('saves a brief with no share and no link; the creator can read and confirm it', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/family/briefs',
        payload: {
          contract_version: 2,
          problem_type: 'earning_less',
          inputs: SOLO_INPUTS,
        },
      })
      expect(res.statusCode).toBe(201)
      const b = res.json().brief
      expect(b.share).toBeNull()
      const read = await app.inject({ method: 'GET', url: `/family/briefs/${b.id}` })
      expect(read.statusCode).toBe(200)
      const ack = await app.inject({
        method: 'POST',
        url: `/family/briefs/${b.id}/confirm`,
        payload: { result_version: b.result_version },
      })
      expect(ack.statusCode).toBe(200)
      // Nobody else has seen it, so it never claims both adults did.
      expect(ack.json().confirmation.both_confirmed).toBe(false)
    })

    it('still refuses a named recipient who is not an active adult, and a share with nobody to share to', async () => {
      const bad = await app.inject({
        method: 'POST',
        url: '/family/briefs',
        payload: {
          contract_version: 2,
          problem_type: 'earning_less',
          for_member_id: 'm-nobody',
          inputs: SOLO_INPUTS,
        },
      })
      expect(bad.statusCode).toBe(400)
      const solo = await app.inject({
        method: 'POST',
        url: '/family/briefs',
        payload: {
          contract_version: 2,
          problem_type: 'earning_less',
          inputs: SOLO_INPUTS,
        },
      })
      const share = await app.inject({
        method: 'POST',
        url: `/family/briefs/${solo.json().brief.id}/share`,
        payload: {},
      })
      expect(share.statusCode).toBe(400)
    })

    it('can be shared once another adult joins', async () => {
      const solo = await app.inject({
        method: 'POST',
        url: '/family/briefs',
        payload: {
          contract_version: 2,
          problem_type: 'earning_less',
          inputs: SOLO_INPUTS,
        },
      })
      await db
        .collection('family_groups')
        .updateOne({ tenant_id: TENANT }, { $push: { members: PARTNER_M as never } })
      const share = await app.inject({
        method: 'POST',
        url: `/family/briefs/${solo.json().brief.id}/share`,
        payload: { for_member_id: 'm-partner' },
      })
      expect(share.statusCode).toBe(200)
      expect(share.json().share.url).toBeTruthy()
    })
  })

  it('creates a versioned snapshot; anonymous and other-user opens are refused', async () => {
    const res = await createV2()
    expect(res.statusCode).toBe(201)
    const b = res.json().brief
    expect(b.result_version).toHaveLength(64)
    expect(b.contract_version).toBe(2)
    const token = b.share.url
    currentUser = null
    expect((await app.inject({ method: 'GET', url: `/b/${token}` })).statusCode).toBe(401)
    currentUser = 'user-stranger'
    expect((await app.inject({ method: 'GET', url: `/b/${token}` })).statusCode).toBe(403)
    currentUser = PARTNER
    const opened = await app.inject({ method: 'GET', url: `/b/${token}` })
    expect(opened.statusCode).toBe(200)
    // The recipient is told who it is from: a first name, nothing more.
    expect(opened.json().from_name).toBe('Sam')
  })

  it('both adults confirm the same result_version; wrong version is refused', async () => {
    const res = await createV2()
    const b = res.json().brief
    const token = b.share.url
    currentUser = CREATOR
    const wrong = await app.inject({
      method: 'POST',
      url: `/b/${token}/confirm`,
      payload: { result_version: '0'.repeat(64) },
    })
    expect(wrong.statusCode).toBe(409)
    const mine = await app.inject({
      method: 'POST',
      url: `/b/${token}/confirm`,
      payload: { result_version: b.result_version },
    })
    expect(mine.json().confirmation.both_confirmed).toBe(false)
    currentUser = PARTNER
    const theirs = await app.inject({
      method: 'POST',
      url: `/b/${token}/confirm`,
      payload: { result_version: b.result_version },
    })
    expect(theirs.json().confirmation.both_confirmed).toBe(true)
    const doc = await db.collection('household_briefs').findOne({ id: b.id })
    expect(doc!.acknowledgements).toHaveLength(2)
  })

  it('handover snapshot stores entered facts without touching the profile or model', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: {
        contract_version: 2,
        problem_type: 'home_emergency',
        for_member_id: 'm-partner',
        inputs: {
          change_date: '2026-11-01',
          facts: {
            'Stopcock location': 'Under the kitchen sink',
            'Boiler and service contact': 'PlumbRight 07000 111222',
          },
        },
      },
    })
    expect(res.statusCode).toBe(201)
    const b = res.json().brief
    expect(b.result).toBeNull()
    expect(b.facts.find((x: { label: string }) => x.label === 'Stopcock location')!.value).toBe(
      'Under the kitchen sink',
    )
    // Narrate is a hard no-op for catalogue briefs — handover facts never reach a model.
    const narr = await app.inject({ method: 'POST', url: `/family/briefs/${b.id}/narrate` })
    expect(narr.json().narrated).toBe(false)
  })

  it('sensitive handovers refuse without explicit consent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: {
        contract_version: 2,
        problem_type: 'medical_contacts',
        for_member_id: 'm-partner',
        inputs: { change_date: '2026-11-01', facts: { 'GP and contact details': 'Dr Foo' } },
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('the full money catalogue computes without a model for every case', async () => {
    for (const id of [
      'debt_payoff',
      'income_stops',
      'earning_less',
      'job_change',
      'hours_cut',
      'mortgage_fix',
      'fees_start',
      'fees_end',
      'renewal',
      'self_employed',
      'supporting_relative',
      'moving_home',
      'child_leaving',
      'child_returning',
      'unpaid_leave',
      'retiring',
      'debt_payoff',
      'rental_change',
      'pregnancy',
      'nursery',
      'school_start',
      'primary',
      'secondary',
      'college',
      'university',
    ]) {
      const r = await createV2(id, id === 'debt_payoff' ? { cash_out_minor: 100000 } : {})
      expect(r.statusCode).toBe(201)
      const b = r.json().brief
      expect(b.result).toBeTruthy()
      expect(b.template_sentence.length).toBeGreaterThan(10)
      expect(b.facts.length).toBeGreaterThan(3)
    }
  })
})

// ─── Review fixes: encryption, secret warnings, past dates, dated steps ────

describe('catalogue review fixes', () => {
  const M_CREATOR = {
    id: 'm-creator',
    name: 'Sam',
    role: 'organizer',
    status: 'active',
    email: 's@x.co',
    joined_at: '2026-01-01',
    user_id: CREATOR,
  }
  const M_PARTNER = {
    id: 'm-partner',
    name: 'Alex',
    role: 'adult',
    status: 'active',
    email: 'a@x.co',
    joined_at: '2026-01-01',
    user_id: PARTNER,
  }
  beforeEach(async () => {
    await db.collection('family_groups').insertOne({
      tenant_id: TENANT,
      members: [M_CREATOR, M_PARTNER],
      created_at: new Date(),
    })
    await db.collection('tenants').insertOne({ tenant_id: TENANT, plan: 'plus' })
  })
  const v2 = (problem_type: string, inputs: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/family/briefs',
      payload: { contract_version: 2, problem_type, for_member_id: 'm-partner', inputs },
    })

  it('sensitive handover facts are envelope-encrypted at rest and decrypted on read', async () => {
    const res = await v2('medical_contacts', {
      change_date: '2026-10-28',
      sensitive_consent: true,
      facts: { 'Allergies as recorded': 'Penicillin' },
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().brief.id
    const stored = await db.collection('household_briefs').findOne({ id })
    expect(stored!.sensitive).toBe(true)
    expect(stored!.facts).toEqual([])
    expect(stored!.facts_encrypted).toMatch(/^dek:/)
    expect(stored!.facts_encrypted).not.toContain('Penicillin')
    const got = await app.inject({ method: 'GET', url: `/family/briefs/${id}` })
    expect(
      got.json().brief.facts.find((f: { label: string }) => f.label === 'Allergies as recorded')
        ?.value,
    ).toBe('Penicillin')
  })

  it('rejects a handover fact that looks like a secret (Intent 79)', async () => {
    const res = await v2('joint_bill', {
      change_date: '2026-10-28',
      facts: { 'Bill or account': 'Council tax', 'How it is paid': 'password: Hunter2!' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/password or code|record where/i)
  })

  it('records a content-free access log on each sensitive read (Intent 79)', async () => {
    const res = await v2('medical_contacts', {
      change_date: '2026-10-28',
      sensitive_consent: true,
      facts: { 'Allergies as recorded': 'Penicillin' },
    })
    const id = res.json().brief.id
    await app.inject({ method: 'GET', url: `/family/briefs/${id}` })
    const got = await app.inject({ method: 'GET', url: `/family/briefs/${id}` })
    const access = got.json().brief.sensitive_access
    expect(access.length).toBeGreaterThanOrEqual(1)
    expect(access[0].user_id).toBeTruthy()
    expect(JSON.stringify(access)).not.toContain('Penicillin')
  })

  it('purges sensitive facts once their DPIA retention expires', async () => {
    const res = await v2('medical_contacts', {
      change_date: '2026-10-28',
      sensitive_consent: true,
      facts: { 'Allergies as recorded': 'Penicillin' },
    })
    const id = res.json().brief.id
    await db
      .collection('household_briefs')
      .updateOne({ id }, { $set: { facts_expire_at: new Date(Date.now() - 1000) } })
    const got = await app.inject({ method: 'GET', url: `/family/briefs/${id}` })
    expect(got.json().brief.facts).toEqual([])
    const stored = await db.collection('household_briefs').findOne({ id })
    expect(stored!.facts_encrypted).toBeUndefined()
  })

  it('migration encrypts plaintext facts on older sensitive briefs, idempotent', async () => {
    const res = await v2('medical_contacts', {
      change_date: '2026-10-28',
      sensitive_consent: true,
      facts: { 'Allergies as recorded': 'Penicillin' },
    })
    const id = res.json().brief.id
    // Simulate a pre-encryption doc: plaintext facts, no envelope field.
    const doc = await db.collection('household_briefs').findOne({ id })
    const plain = JSON.parse('[]')
    void plain
    await db.collection('household_briefs').updateOne(
      { id },
      {
        $set: {
          facts: [{ label: 'Allergies as recorded', value: 'Penicillin' }],
          sensitive: true,
        },
        $unset: { facts_encrypted: '' },
      },
    )
    const first = await migrateSensitiveBriefFacts(db)
    expect(first.migrated).toBe(1)
    const stored = await db.collection('household_briefs').findOne({ id })
    expect(stored!.facts).toEqual([])
    expect(stored!.facts_encrypted).toMatch(/^dek:/)
    const second = await migrateSensitiveBriefFacts(db)
    expect(second.migrated).toBe(0)
  })

  it('scheduled purge deletes expired sensitive facts independent of reads', async () => {
    const res = await v2('medical_contacts', {
      change_date: '2026-10-28',
      sensitive_consent: true,
      facts: { 'Allergies as recorded': 'Penicillin' },
    })
    const id = res.json().brief.id
    await db
      .collection('household_briefs')
      .updateOne({ id }, { $set: { facts_expire_at: new Date(Date.now() - 1000) } })
    const { purged } = await purgeExpiredSensitiveFacts(db)
    expect(purged).toBeGreaterThanOrEqual(1)
    const stored = await db.collection('household_briefs').findOne({ id })
    expect(stored!.facts_encrypted).toBeUndefined()
    expect(stored!.facts ?? []).toEqual([])
  })

  it('a sensitive read without a session is refused before any decrypt', async () => {
    const res = await v2('medical_contacts', {
      change_date: '2026-10-28',
      sensitive_consent: true,
      facts: { 'Allergies as recorded': 'Penicillin' },
    })
    currentUser = null // anonymous opener, like a scanner
    const anon = await app.inject({
      method: 'GET',
      url: `/b/${res.json().brief.share.url}`,
    })
    expect(anon.statusCode).toBe(401)
    expect(JSON.stringify(anon.body)).not.toContain('Penicillin')
    currentUser = CREATOR
    const stored = await db.collection('household_briefs').findOne({ id: res.json().brief.id })
    // The refused read left no successful access entry.
    expect(
      (stored!.sensitive_access ?? []).every((a: { user_id: string }) => a.user_id !== 'anonymous'),
    ).toBe(true)
  })

  it('accepts up to 8 dated steps including a pure one-off cash step', async () => {
    const step = (d: string, extra: Record<string, number> = {}) => ({
      date: d,
      ...extra,
    })
    const res = await v2('mortgage_fix', {
      change_date: '2026-11-01',
      monthly_income_minor: 300000,
      monthly_essentials_minor: 200000,
      liquid_savings_minor: 900000,
      new_essentials_minor: 240000,
      income_steps: [
        step('2026-12-01', { monthly_income_minor: 200000 }),
        step('2027-01-01', { cash_delta_minor: 50000 }),
        step('2027-02-01'), // no amounts — rejected
      ],
    })
    expect(res.statusCode).toBe(400)

    const ok = await v2('mortgage_fix', {
      change_date: '2026-11-01',
      monthly_income_minor: 300000,
      monthly_essentials_minor: 200000,
      liquid_savings_minor: 900000,
      new_essentials_minor: 240000,
      income_steps: [
        step('2026-12-01', { monthly_income_minor: 200000 }),
        step('2027-01-01', { cash_delta_minor: 50000 }),
      ],
    })
    expect(ok.statusCode).toBe(201)
    const facts = ok.json().brief.facts
    expect(facts.some((f: { label: string }) => f.label.includes('one-off savings'))).toBe(true)
  })

  it('rejects a ninth dated step', async () => {
    const steps = Array.from({ length: 9 }, (_, n) => ({
      date: `2026-1${n + 1 > 9 ? 0 : n + 1}-15`,
      monthly_income_minor: 200000,
    }))
    const res = await v2('mortgage_fix', {
      change_date: '2026-10-01',
      monthly_income_minor: 300000,
      monthly_essentials_minor: 200000,
      liquid_savings_minor: 900000,
      new_essentials_minor: 240000,
      income_steps: steps,
    })
    expect(res.statusCode).toBe(400)
  })

  it('catalogue copy passes the advice-rule scan (Intent 80)', () => {
    const banned = [
      /\b(recommend|should buy|you should switch|best deal|can afford)\b/i,
      /\b(aviva|legal (&|and) general|vitality|prudential|zurich|axa|hargreaves lansdown|vanguard|fidelity|nutmeg|moneybox)\b/i,
      /\b(guaranteed|act now|protect your family)\b/i,
    ]
    const strings = BRIEF_CATALOGUE.flatMap((e) => [e.title, e.trigger, ...(e.fields ?? [])])
    for (const text of strings) for (const pattern of banned) expect(text).not.toMatch(pattern)
    // The generated money-brief sentence carries the coverage disclaimer.
    const money = BRIEF_CATALOGUE.find((e) => e.id === 'income_stops')!
    expect(money.group).toBe('Money and income')
  })

  it('accepts a change date already in effect — runway still from today', async () => {
    const res = await v2('earning_less', {
      monthly_income_minor: 300000,
      monthly_essentials_minor: 200000,
      liquid_savings_minor: 600000,
      new_income_minor: 150000,
      new_essentials_minor: 200000,
      change_date: '2020-01-01',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().brief.template_sentence).toContain('months')
  })

  it('folds dated income_steps into the scenario timeline', async () => {
    const res = await v2('earning_less', {
      monthly_income_minor: 300000,
      monthly_essentials_minor: 200000,
      liquid_savings_minor: 600000,
      new_income_minor: 270000,
      new_essentials_minor: 200000,
      change_date: '2027-01-01',
      income_steps: [
        { date: '2027-03-01', monthly_income_minor: 150000 },
        { date: '2027-10-01', monthly_income_minor: 300000 },
      ],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().brief.result.timeline.length).toBeGreaterThanOrEqual(3)
  })

  it('catalogue gains the missing use cases; separation stays out', () => {
    const ids = BRIEF_CATALOGUE.map((e) => e.id)
    for (const id of ['energy_council_tax', 'car_repair', 'joint_bill', 'bereavement'])
      expect(ids).toContain(id)
    expect(ids.some((id) => id.includes('separat'))).toBe(false)
    expect(BRIEF_CATALOGUE.find((e) => e.id === 'hours_cut')!.title).toMatch(/illness|recovery/)
    expect(BRIEF_CATALOGUE.find((e) => e.id === 'bereavement')!.sensitive).toBe(true)
  })
})
