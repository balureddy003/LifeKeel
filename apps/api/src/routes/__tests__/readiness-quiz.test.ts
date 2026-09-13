/**
 * POST /readiness-quiz — public, unauthenticated "Family Readiness Score"
 * (PRD-201). Runs quiz answers through the exact same detector rules a
 * real account uses, and — the actual point of this PRD — never persists
 * anything tied to an identifier: no signal write, no tenant, only an
 * anonymized score-band funnel event.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { Engine } from '@agentoak/engine'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerReadinessQuizRoutes } from '../readiness-quiz.js'
import { persistSignal } from '../../signals.js'

vi.mock('../../signals.js', () => ({
  persistSignal: vi.fn(async () => 'stub-signal-id'),
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../../detectors')

function makeDb() {
  const inserted: Record<string, unknown>[] = []
  const col = { insertOne: vi.fn(async (doc: Record<string, unknown>) => { inserted.push(doc) }) }
  return { db: { collection: () => col } as any, inserted }
}

const UNDER_PROTECTED = {
  monthly_salary_minor: 400_000,
  emergency_savings_minor: 0,
  monthly_expenses_minor: 300_000,
  mortgage_outstanding_minor: 20_000_000,
  life_cover_minor: 0,
  dependents: 2,
}

const WELL_COVERED = {
  monthly_salary_minor: 400_000,
  emergency_savings_minor: 5_000_000,
  monthly_expenses_minor: 300_000,
  mortgage_outstanding_minor: 0,
  life_cover_minor: 50_000_000,
  dependents: 0,
}

describe('POST /readiness-quiz', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
    vi.mocked(persistSignal).mockClear()
  })

  async function buildApp() {
    const app = Fastify()
    const { db, inserted } = makeDb()
    await registerReadinessQuizRoutes(app, db, engine)
    return { app, inserted }
  }

  it('returns a low score with real detector reasoning for an under-protected household', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/readiness-quiz', payload: UNDER_PROTECTED })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.score).toBeLessThan(100)
    expect(body.insights.length).toBeGreaterThan(0)
    expect(body.insights.some((i: { reasoning: string }) => i.reasoning.length > 0)).toBe(true)
  })

  it('returns a higher score with fewer insights for a well-covered household', async () => {
    const { app: underApp } = await buildApp()
    const { app: wellApp } = await buildApp()

    const underRes = await underApp.inject({ method: 'POST', url: '/readiness-quiz', payload: UNDER_PROTECTED })
    const wellRes = await wellApp.inject({ method: 'POST', url: '/readiness-quiz', payload: WELL_COVERED })

    expect(wellRes.json().score).toBeGreaterThan(underRes.json().score)
    expect(wellRes.json().insights.length).toBeLessThanOrEqual(underRes.json().insights.length)
  })

  it('never persists a signal tied to any identifier', async () => {
    const { app } = await buildApp()
    await app.inject({ method: 'POST', url: '/readiness-quiz', payload: UNDER_PROTECTED })
    expect(persistSignal).not.toHaveBeenCalled()
  })

  it('logs only an anonymized score-band growth event, no identifying fields', async () => {
    const { app, inserted } = await buildApp()
    await app.inject({ method: 'POST', url: '/readiness-quiz', payload: UNDER_PROTECTED })

    expect(inserted).toHaveLength(1)
    const event = inserted[0]
    expect(event['event']).toBe('readiness_quiz_completed')
    expect(typeof (event['meta'] as Record<string, unknown>)['score_band']).toBe('string')
    expect(Object.keys(event).sort()).toEqual(['created_at', 'event', 'meta'])
  })

  it('400s on malformed/missing quiz answers', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/readiness-quiz', payload: { monthly_salary_minor: 'not-a-number' } })
    expect(res.statusCode).toBe(400)
  })
})
