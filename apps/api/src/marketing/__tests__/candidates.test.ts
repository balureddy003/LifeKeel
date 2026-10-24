import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { draftCandidates, TARGET_ENTRIES_PER_CHANNEL } from '../candidates.js'
import { addCandidate, bankCollection, LINK_TOKEN } from '../bank.js'
import { enableStanding, policyCollection, standingIssues } from '../standing.js'
import { checkCopy } from '../copy-guard.js'
import { buildDecisions } from '../../operator/mission-control.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const NOW = new Date('2026-10-20T08:00:00Z')
const T = 't1'
const llm = async () =>
  'Where does your family stand? A look at what is on file and what looks missing. Free to start.'

async function connect(channel: string) {
  await db.collection('social_connections').insertOne({
    tenant_id: T,
    channel,
    handle: 'h',
    credentials: {},
    status: 'active',
  })
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('candidates')
})
beforeEach(async () => {
  await db.dropDatabase()
  await connect('bluesky')
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('candidate drafting', () => {
  it('drafts nothing without a live standing policy', async () => {
    const run = await draftCandidates(db, () => llm, NOW)
    expect(run.drafted).toBe(0)
    expect(await bankCollection(db).countDocuments()).toBe(0)
  })

  it('drafts one candidate per network, as candidates only: never approved, never a post', async () => {
    await enableStanding(
      db,
      T,
      'founder-1',
      { reason: 'routine', expires_in_days: 30, channels: ['bluesky'] },
      NOW,
    )
    const run = await draftCandidates(db, () => llm, NOW)
    expect(run.drafted).toBe(1)
    const [c] = await bankCollection(db).find({ tenant_id: T }).toArray()
    expect(c).toMatchObject({
      status: 'candidate',
      source: 'candidate_job',
      created_by: 'system:candidates',
    })
    expect(c?.approved_by).toBeUndefined()
    expect(c?.channels).toEqual(['bluesky'])
    expect(checkCopy(c!.content.replace(LINK_TOKEN, ''), 'social').ok).toBe(true)
    // Drafting never creates a post of any state.
    expect(await db.collection('marketing_posts').countDocuments()).toBe(0)
  })

  it('stops drafting for a network once its bank is full, and skips unhealthy or paused networks', async () => {
    await connect('x')
    await enableStanding(
      db,
      T,
      'founder-1',
      { reason: 'routine', expires_in_days: 30, channels: ['bluesky', 'x', 'linkedin'] },
      NOW,
    )
    for (let i = 0; i < TARGET_ENTRIES_PER_CHANNEL; i++)
      await addCandidate(
        db,
        T,
        'op',
        { content: `Filler ${i}. ${LINK_TOKEN}`, channels: ['bluesky'], source: 'manual' },
        NOW,
      )
    await policyCollection(db).updateOne(
      { tenant_id: T },
      { $push: { paused_channels: { channel: 'x', reason: 'test', at: NOW } } },
    )
    const run = await draftCandidates(db, () => llm, NOW)
    expect(run.skipped_full).toBe(1) // bluesky is full
    expect(run.drafted).toBe(0) // x paused, linkedin has no connection
  })

  it('does not store the same text twice', async () => {
    await enableStanding(
      db,
      T,
      'founder-1',
      { reason: 'routine', expires_in_days: 30, channels: ['bluesky'] },
      NOW,
    )
    expect((await draftCandidates(db, () => llm, NOW)).drafted).toBe(1)
    // The model returns the same text again; the duplicate is dropped.
    const again = await draftCandidates(db, () => llm, NOW)
    expect(again).toMatchObject({ drafted: 0, skipped_unusable: 1 })
    expect(await bankCollection(db).countDocuments({ tenant_id: T })).toBe(1)
  })

  it('does not draft for Instagram unless it can attach a card', async () => {
    await connect('instagram')
    await enableStanding(
      db,
      T,
      'founder-1',
      { reason: 'routine', expires_in_days: 30, channels: ['instagram'] },
      NOW,
    )
    await draftCandidates(db, () => llm, NOW)
    for (const e of await bankCollection(db).find({ tenant_id: T }).toArray())
      expect(e.card).toBeTruthy()
  })

  it('drops a draft that fails the copy guard instead of storing it', async () => {
    await enableStanding(
      db,
      T,
      'founder-1',
      { reason: 'routine', expires_in_days: 30, channels: ['bluesky'] },
      NOW,
    )
    const run = await draftCandidates(
      db,
      () => async () => 'You should buy this policy today.',
      NOW,
    )
    expect(run.drafted).toBe(0)
    expect(run.skipped_unusable).toBe(1)
  })
})

describe('what needs a person', () => {
  async function policy(days = 30) {
    await enableStanding(
      db,
      T,
      'founder-1',
      { reason: 'routine', expires_in_days: days, channels: ['bluesky'] },
      NOW,
    )
  }

  it('raises waiting candidates, expiry, a paused network and a thin bank', async () => {
    await policy(3)
    await addCandidate(
      db,
      T,
      'op',
      { content: `A candidate. ${LINK_TOKEN}`, channels: ['bluesky'], source: 'manual' },
      NOW,
    )
    await policyCollection(db).updateOne(
      { tenant_id: T },
      {
        $push: {
          paused_channels: { channel: 'bluesky', reason: '2 publish failures in a row', at: NOW },
        },
      },
    )
    const kinds = (await standingIssues(db, NOW)).map((i) => i.kind).sort()
    expect(kinds).toEqual(['bank_low', 'candidates_waiting', 'channel_paused', 'expiring'].sort())
  })

  it('reports an expired approval, and nothing at all when standing approvals were never used', async () => {
    expect(await standingIssues(db, NOW)).toEqual([])
    await policy(1)
    const later = new Date(NOW.getTime() + 2 * 86_400_000)
    expect((await standingIssues(db, later)).map((i) => i.kind)).toContain('expired')
  })

  it('shows up in Mission Control for a manager, never as a batch action, and not for a support agent', async () => {
    await policy(3)
    await addCandidate(
      db,
      T,
      'op',
      { content: `A candidate. ${LINK_TOKEN}`, channels: ['bluesky'], source: 'manual' },
      NOW,
    )
    const mine = await buildDecisions(db, { user_id: 'me', roles: ['super_admin'] }, NOW)
    const standing = mine.filter((d) => d.kind === 'standing_attention')
    expect(standing.length).toBeGreaterThan(0)
    for (const d of standing) {
      expect(d.batchable).toBe(false)
      expect(d.required_permission).toBe('marketing.manage')
      expect(d.href).toBe('/operator/marketing')
    }
    const support = await buildDecisions(db, { user_id: 'me', roles: ['support'] }, NOW)
    expect(support.filter((d) => d.kind === 'standing_attention')).toEqual([])
  })
})
