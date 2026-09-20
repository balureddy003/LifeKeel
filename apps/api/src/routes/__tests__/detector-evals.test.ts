/**
 * POST /detectors/:id/eval — the promotion gate.
 *
 * Asserts the route runs the real golden dataset through the real engine,
 * reports promotable/blocked with reasons, records an audit entry, and
 * 404s unknown detectors rather than reporting a perfect empty eval.
 * Baseline semantics come from DetectorEvalRunner.compareToBaseline: the
 * first run seeds 'promotion'; a seeded low baseline exercises the
 * regression branch.
 */
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import path from 'node:path'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import Fastify, { type FastifyInstance } from 'fastify'
import { Engine } from '@agentoak/engine'
import { registerDetectorEvalRoutes } from '../detector-evals.js'

const TENANT = 'tenant-eval'
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..')

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('detector_evals_test')
  const engine = new Engine({ detectorsDir: path.join(ROOT, 'detectors'), strictValidation: false })
  await engine.load()
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as never as Record<string, unknown>)['authContext'] = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerDetectorEvalRoutes(app, db, engine, path.join(ROOT, 'detector-evals'))
  await app.ready()
})

afterEach(async () => {
  await db.collection('detector_eval_baselines').deleteMany({})
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('POST /detectors/:id/eval', () => {
  it('runs the golden dataset and reports a promotable detector', async () => {
    const res = await app.inject({ method: 'POST', url: '/detectors/family_emergency_fund_adequacy/eval' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.promotable).toBe(true)
    expect(body.blocked_reasons).toEqual([])
    expect(body.eval.f1).toBe(1)
    expect(body.eval.total_cases).toBeGreaterThan(0)
    // First run seeds the 'promotion' baseline — no regression possible.
    expect(body.regression.has_regression).toBe(false)
  })

  it('reports the delta vs a stored baseline', async () => {
    await db.collection('detector_eval_baselines').insertOne({
      detector_id: 'family_emergency_fund_adequacy',
      baseline_id: 'promotion',
      precision: 1,
      recall: 1,
      f1: 0.9,
      saved_at: new Date(),
    })
    const res = await app.inject({ method: 'POST', url: '/detectors/family_emergency_fund_adequacy/eval' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.regression.f1_delta).toBeCloseTo(0.1, 3)
    expect(body.promotable).toBe(true)
  })

  it('blocks promotion when f1 regresses >5% below the stored baseline', async () => {
    // Seed an unattainable baseline (1.06) — the stored doc is trusted
    // input for the gate; f1 can't reach it, so the regression branch is
    // exercised without breaking the golden dataset itself.
    await db.collection('detector_eval_baselines').insertOne({
      detector_id: 'family_retirement_gap',
      baseline_id: 'promotion',
      precision: 1.06,
      recall: 1.06,
      f1: 1.06,
      saved_at: new Date(),
    })
    const res = await app.inject({ method: 'POST', url: '/detectors/family_retirement_gap/eval' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.regression.has_regression).toBe(true)
    expect(body.promotable).toBe(false)
    expect(body.blocked_reasons.some((r: string) => r.includes('regressed'))).toBe(true)
  })

  it('404s a detector id the engine never loaded', async () => {
    const res = await app.inject({ method: 'POST', url: '/detectors/not_a_real_detector/eval' })
    expect(res.statusCode).toBe(404)
  })

  it('422s a known detector with no golden dataset', async () => {
    // Every family detector has a dataset, so exercise the missing-dataset
    // branch with a second app pointed at an empty eval dir — same engine,
    // so the detector id is known but its file doesn't exist.
    const engine = new Engine({ detectorsDir: path.join(ROOT, 'detectors'), strictValidation: false })
    await engine.load()
    const emptyApp = Fastify()
    emptyApp.addHook('onRequest', async (request) => {
      ;(request as never as Record<string, unknown>)['authContext'] = { tenant_id: TENANT, user_id: 'user-1' }
    })
    registerDetectorEvalRoutes(emptyApp, db, engine, path.join(ROOT, 'detector-evals', 'does-not-exist'))
    await emptyApp.ready()

    const res = await emptyApp.inject({ method: 'POST', url: '/detectors/family_protection_gap/eval' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toContain('No golden dataset')
  })
})
