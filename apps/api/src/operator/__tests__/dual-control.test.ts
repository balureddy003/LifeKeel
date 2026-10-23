import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { FastifyRequest } from 'fastify'
import { checkDualApproval, type DualApprovalSpec } from '../dual-control.js'
import type { OperatorAuditLogger } from '../operator-audit.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('dual-control-test')
})

beforeEach(async () => {
  await db.collection('operator_dual_approvals').deleteMany({})
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const audit = { log: async () => undefined } as unknown as OperatorAuditLogger

function req(operatorId: string, body: Record<string, unknown> = {}): FastifyRequest {
  return { operatorContext: { user_id: operatorId }, body } as unknown as FastifyRequest
}

const spec: DualApprovalSpec = {
  action: 'operator.campaign.send',
  targetType: 'campaign',
  targetId: 'c1',
  payload: { reason: 'welcome send' },
  permission: 'marketing.manage',
  reason: 'welcome send',
}

/** Request as op-a, confirm as op-b, return the approval id. */
async function confirmedApproval(): Promise<string> {
  const first = await checkDualApproval(db, audit, req('op-a'), spec)
  expect(first.kind).toBe('respond')
  const doc = await db.collection('operator_dual_approvals').findOne({ requested_by: 'op-a' })
  await db
    .collection('operator_dual_approvals')
    .updateOne({ id: doc!['id'] }, { $set: { status: 'confirmed', confirmed_by: 'op-b' } })
  return doc!['id'] as string
}

describe('checkDualApproval release()', () => {
  it('hands a spent approval back so a failed action can be retried without a new second operator', async () => {
    await confirmedApproval()

    const spent = await checkDualApproval(db, audit, req('op-a'), spec)
    expect(spent.kind).toBe('proceed')
    // Without release the approval is gone and a retry would open a new request.
    if (spent.kind !== 'proceed') throw new Error('unreachable')
    await spent.release()

    const retry = await checkDualApproval(db, audit, req('op-a'), spec)
    expect(retry.kind).toBe('proceed')
    expect(await db.collection('operator_dual_approvals').countDocuments()).toBe(1)
  })

  it('works for an explicit confirmation_id retry too', async () => {
    const id = await confirmedApproval()
    const body = { confirmation_id: id }

    const spent = await checkDualApproval(db, audit, req('op-a', body), spec)
    if (spent.kind !== 'proceed') throw new Error('expected proceed')
    await spent.release()

    expect((await checkDualApproval(db, audit, req('op-a', body), spec)).kind).toBe('proceed')
  })

  it('without release the approval stays consumed (an executed action is not re-armed)', async () => {
    const id = await confirmedApproval()
    const body = { confirmation_id: id }
    expect((await checkDualApproval(db, audit, req('op-a', body), spec)).kind).toBe('proceed')

    const again = await checkDualApproval(db, audit, req('op-a', body), spec)
    expect(again).toMatchObject({ kind: 'respond', status: 409 })
  })

  it('release is a no-op once the approval is not in the consumed state', async () => {
    const id = await confirmedApproval()
    const spent = await checkDualApproval(db, audit, req('op-a', { confirmation_id: id }), spec)
    if (spent.kind !== 'proceed') throw new Error('expected proceed')
    await spent.release()
    await spent.release() // second call must not throw or change state
    const doc = await db.collection('operator_dual_approvals').findOne({ id })
    expect(doc?.['status']).toBe('confirmed')
    expect(doc?.['consumed_at']).toBeUndefined()
  })
})
