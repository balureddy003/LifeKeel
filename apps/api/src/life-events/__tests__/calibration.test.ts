/**
 * PRD-213 M4: the drift-sentinel calibration harness — shadow-only candidate
 * signals with an explicit abstention band, plus the summary that turns rows
 * into precision/miss evidence before any nudge widens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  evaluateCandidateLifeChanges,
  recordCalibrationCandidates,
  calibrationSummary,
  LIFE_CHANGE_CALIBRATION_COLLECTION,
} from '../calibration.js'
import {
  detectUnreportedLifeChange,
  type ProfileChangeSnapshot,
} from '../detect-unreported-change.js'

function snapshot(overrides: Partial<ProfileChangeSnapshot> = {}): ProfileChangeSnapshot {
  return {
    earners: [{ employment_status: 'employed', monthly_salary_minor: 400_000 }],
    emergency_savings_minor: 900_000,
    ...overrides,
  }
}

describe('evaluateCandidateLifeChanges', () => {
  it('returns nothing on a first-ever save', () => {
    expect(evaluateCandidateLifeChanges(null, snapshot())).toEqual([])
  })

  it('returns nothing when nothing moved', () => {
    expect(evaluateCandidateLifeChanges(snapshot(), snapshot())).toEqual([])
  })

  it('fires salary_drop_major on a ≥50% pay cut that stops short of zero', () => {
    const next = snapshot({
      earners: [{ employment_status: 'employed', monthly_salary_minor: 150_000 }],
    })
    expect(evaluateCandidateLifeChanges(snapshot(), next)).toEqual([
      { reason: 'salary_drop_major', verdict: 'fire' },
    ])
  })

  it('abstains on a 25–50% pay cut — the border zone is counted, not nudged', () => {
    const next = snapshot({
      earners: [{ employment_status: 'employed', monthly_salary_minor: 260_000 }],
    })
    expect(evaluateCandidateLifeChanges(snapshot(), next)).toEqual([
      { reason: 'salary_drop_major', verdict: 'abstain' },
    ])
  })

  it('never shadows a diff the shipped detector already fires on', () => {
    // employment_status_change fires → the candidate stays out of the way.
    const next = snapshot({
      earners: [{ employment_status: 'unemployed', monthly_salary_minor: 0 }],
    })
    expect(detectUnreportedLifeChange(snapshot(), next)).toBe('employment_status_change')
    expect(
      evaluateCandidateLifeChanges(snapshot(), next).some((c) => c.reason === 'salary_drop_major'),
    ).toBe(false)
  })

  it('fires emergency_fund_shrinking on a 20–40% drawdown (below the shipped 40% rule)', () => {
    const previous = snapshot({ emergency_savings_minor: 1_000_000 })
    const next = snapshot({ emergency_savings_minor: 700_000 }) // 30% drop
    expect(detectUnreportedLifeChange(previous, next)).toBeNull()
    expect(evaluateCandidateLifeChanges(previous, next)).toEqual([
      { reason: 'emergency_fund_shrinking', verdict: 'fire' },
    ])
  })

  it('abstains on a 10–20% drawdown', () => {
    const previous = snapshot({ emergency_savings_minor: 1_000_000 })
    const next = snapshot({ emergency_savings_minor: 850_000 }) // 15% drop
    expect(evaluateCandidateLifeChanges(previous, next)).toEqual([
      { reason: 'emergency_fund_shrinking', verdict: 'abstain' },
    ])
  })

  it('stays clear when the shipped 40% drain rule already fires', () => {
    const previous = snapshot({ emergency_savings_minor: 1_000_000 })
    const next = snapshot({ emergency_savings_minor: 500_000 }) // 50% drop
    expect(detectUnreportedLifeChange(previous, next)).toBe('emergency_fund_drained')
    expect(
      evaluateCandidateLifeChanges(previous, next).some(
        (c) => c.reason === 'emergency_fund_shrinking',
      ),
    ).toBe(false)
  })

  it('flags earners joining and leaving the roster', () => {
    const previous: ProfileChangeSnapshot = {
      earners: [
        { member_id: 'm1', employment_status: 'employed', monthly_salary_minor: 300_000 },
        { member_id: 'm2', employment_status: 'employed', monthly_salary_minor: 200_000 },
      ],
      emergency_savings_minor: 900_000,
    }
    const next: ProfileChangeSnapshot = {
      earners: [
        { member_id: 'm2', employment_status: 'employed', monthly_salary_minor: 200_000 },
        { member_id: 'm3', employment_status: 'employed', monthly_salary_minor: 100_000 },
      ],
      emergency_savings_minor: 900_000,
    }
    const reasons = evaluateCandidateLifeChanges(previous, next).map((c) => c.reason)
    expect(reasons).toContain('new_earner_added')
    expect(reasons).toContain('earner_removed')
  })
})

describe('recordCalibrationCandidates + calibrationSummary', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('life-change-calibration')
  })

  afterAll(async () => {
    await client.close()
    await mongod.stop()
  })

  it('writes only non-clear verdicts, tenant-scoped, and never throws', async () => {
    await recordCalibrationCandidates(db, 't1', [
      { reason: 'salary_drop_major', verdict: 'fire' },
      { reason: 'emergency_fund_shrinking', verdict: 'abstain' },
      { reason: 'new_earner_added', verdict: 'clear' },
    ])
    const rows = await db.collection(LIFE_CHANGE_CALIBRATION_COLLECTION).find({}).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r['tenant_id'] === 't1' && r['fired_at'] instanceof Date)).toBe(true)

    // Empty candidate list → no write at all.
    await db.collection(LIFE_CHANGE_CALIBRATION_COLLECTION).deleteMany({})
    await recordCalibrationCandidates(db, 't1', [])
    expect(await db.collection(LIFE_CHANGE_CALIBRATION_COLLECTION).countDocuments()).toBe(0)
  })

  it('matches fired rows to life events inside the 30-day window only', async () => {
    const T = 't-match'
    const now = Date.now()
    const day = 24 * 3_600_000
    await db.collection(LIFE_CHANGE_CALIBRATION_COLLECTION).insertMany([
      {
        tenant_id: T,
        reason: 'salary_drop_major',
        verdict: 'fire',
        fired_at: new Date(now - 5 * day),
      },
      {
        tenant_id: T,
        reason: 'salary_drop_major',
        verdict: 'fire',
        fired_at: new Date(now - 5 * day),
      },
      {
        tenant_id: T,
        reason: 'earner_removed',
        verdict: 'fire',
        fired_at: new Date(now - 60 * day),
      },
      {
        tenant_id: T,
        reason: 'emergency_fund_shrinking',
        verdict: 'abstain',
        fired_at: new Date(now - 5 * day),
      },
    ])
    // One life event reported after two of the fired rows; none after earner_removed.
    await db.collection('signals').insertOne({
      tenant_id: T,
      signal_type: 'family.life_event',
      created_at: new Date(now - 4 * day),
    })

    const summary = await calibrationSummary(db, T)
    const byReason = new Map(summary.map((r) => [r.reason, r]))
    expect(byReason.get('salary_drop_major')).toMatchObject({ fired: 2, fired_matched: 2 })
    expect(byReason.get('earner_removed')).toMatchObject({ fired: 1, fired_matched: 0 })
    expect(byReason.get('emergency_fund_shrinking')).toMatchObject({
      abstained: 1,
      abstained_matched: 1,
    })
  })

  it('keeps tenants isolated', async () => {
    const other = await calibrationSummary(db, 't-never-seen')
    expect(other).toEqual([])
  })
})
