/**
 * Unit tests for AuditLogger.logWithRetry — the retrying audit write path
 * for financial actions (gap #27, TRADING_ENGINE_GAPS.md).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuditLogger } from '../audit/audit-log.js'
import type { Db } from 'mongodb'

function makeDb(insertFails: boolean[] = []) {
  const state = { insertCalls: 0 }
  const insertOneFn = vi.fn(async () => {
    const shouldFail = insertFails[state.insertCalls] ?? false
    state.insertCalls++
    if (shouldFail) throw new Error('Transient DB error')
    return { acknowledged: true, insertedId: 'test-id' }
  })
  const db = {
    collection: () => ({
      createIndex: vi.fn(async () => {}),
      insertOne: insertOneFn,
    }),
  } as unknown as Db
  return { db, state, insertOneFn }
}

const TEST_ENTRY = {
  tenant_id: 'tenant-test',
  user_id: 'system:cron',
  action: 'trade.execute' as const,
  resource_type: 'pending_trade',
  resource_id: 'trade-123',
  metadata: { ticker: 'AAPL', status: 'executed' },
  ip: 'internal',
  user_agent: 'kairos-cron',
  timestamp: new Date(),
}

describe('AuditLogger.logWithRetry — gap #27', () => {
  it('writes successfully on the first attempt (no retry needed)', async () => {
    const { db, state } = makeDb([false])
    const logger = new AuditLogger(db, true)
    await logger.logWithRetry(TEST_ENTRY)
    expect(state.insertCalls).toBe(1)
  })

  it('retries on transient failure and succeeds on the second attempt', async () => {
    const { db, state } = makeDb([true, false])
    const logger = new AuditLogger(db, true)
    await logger.logWithRetry(TEST_ENTRY)
    expect(state.insertCalls).toBe(2)
  })

  it('retries up to 3 times and logs to stderr if all fail', async () => {
    const { db, state } = makeDb([true, true, true])
    const logger = new AuditLogger(db, true)
    // Should not throw — logs to stderr and returns
    await logger.logWithRetry(TEST_ENTRY)
    expect(state.insertCalls).toBe(3)
  })

  it('does nothing when audit logging is disabled', async () => {
    const { db, state } = makeDb()
    const logger = new AuditLogger(db, false)
    await logger.logWithRetry(TEST_ENTRY)
    expect(state.insertCalls).toBe(0)
  })
})
