/**
 * Integration test for the users.email index against REAL MongoDB.
 *
 * registerOperatorRoutes() (operator.ts) and getUsersCollection() (auth-users.ts) both create an
 * index on users.email under the auto name email_1. On a fresh database they race, and MongoDB
 * rejects the loser when the options differ (non-unique vs unique), which made POST /auth/signup
 * return 500. This runs both concurrently on an empty collection.
 *
 * Runs wherever MONGODB_URL is reachable (CI provides it). Locally without it the test is skipped
 * with a reason; in CI (CI=true) a missing MongoDB FAILS the test rather than skipping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const dbName = `lifekeel_users_idx_it_${randomUUID().slice(0, 8)}`
// getUsersCollection() resolves its database via getDb(), which reads this at first connect.
process.env['MONGODB_DB'] = dbName

const { getDb, getMongoClient, closeDb } = await import('../db.js')
const { getUsersCollection } = await import('../routes/auth-users.js')
const { registerOperatorRoutes } = await import('../routes/operator.js')

const inCi = process.env['CI'] === 'true'
let available = false
let unavailableReason = ''
let db: import('mongodb').Db | undefined

try {
  await Promise.race([
    getMongoClient(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('MongoDB not reachable within 5s')), 5000)),
  ])
  db = await getDb()
  await db.command({ ping: 1 })
  available = true
} catch (err) {
  unavailableReason = (err as Error).message
}

describe.skipIf(!available && !inCi)('users.email index (real MongoDB)', () => {
  beforeAll(() => {
    if (!available) throw new Error(`MongoDB required in CI but unavailable: ${unavailableReason}`)
  })

  afterAll(async () => {
    await db?.dropDatabase()
    await closeDb()
  })

  it('operator registration and getUsersCollection() can race on a fresh collection', async () => {
    for (let i = 0; i < 5; i++) {
      await db!.collection('users').drop().catch(() => {})
      await db!.createCollection('users')

      const app = Fastify()
      // operator.ts fires its createIndex calls without awaiting; getUsersCollection awaits its own.
      const [, users] = await Promise.all([registerOperatorRoutes(app, db!), getUsersCollection()])
      expect(users.collectionName).toBe('users')
      await app.close()

      // Let operator.ts's fire-and-forget index builds settle before inspecting.
      await new Promise(r => setTimeout(r, 300))
      const emailIndexes = (await db!.collection('users').indexes()).filter(
        ix => JSON.stringify(ix.key) === JSON.stringify({ email: 1 }),
      )
      expect(emailIndexes).toHaveLength(1)
      expect(emailIndexes[0]).toMatchObject({ name: 'email_1', unique: true })
    }
  })
})
