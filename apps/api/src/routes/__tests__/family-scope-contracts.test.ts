/**
 * /family/scope-contracts (PRD-214, M5) — autonomy as an explicit, versioned,
 * grantable, reviewable, collapsible artifact. v1: notification-class only.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

import { registerFamilyScopeContractRoutes } from '../family-scope-contracts.js'
import { registerAutomationSettingsRoutes } from '../automation-settings.js'
import {
  maybeSuspendScopeOnFailures,
  SUSPEND_AFTER_CONSECUTIVE_FAILURES,
} from '../../family/scope-contracts.js'

const TENANT = 't-scope'
const ADULT = 'adult-1'
const CHILD = 'child-1'
const SCOPE = 'policy_renewal_reminders'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

async function buildApp(userId: string): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: userId }
  })
  registerFamilyScopeContractRoutes(app, db)
  registerAutomationSettingsRoutes(app, db)
  await app.ready()
  return app
}

const flag = () =>
  db
    .collection('tenant_settings')
    .findOne({ tenant_id: TENANT })
    .then(
      (d) =>
        (d?.['automation'] as Record<string, unknown> | undefined)?.['renewal_reminders_enabled'],
    )

const contract = () =>
  db.collection('scope_contracts').findOne({ tenant_id: TENANT, scope_id: SCOPE })

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('scope-contracts')
})

beforeEach(async () => {
  await db.dropDatabase()
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    id: 'fam-1',
    name: 'Test Family',
    members: [
      { id: ADULT, name: 'Sam', email: 's@x.co', role: 'organizer', status: 'active' },
      { id: CHILD, name: 'Kid', email: '', role: 'child', status: 'active' },
    ],
    created_at: new Date(),
  })
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('scope contracts (PRD-214 M5)', () => {
  it('denies a child member on read and write', async () => {
    const app = await buildApp(CHILD)
    expect((await app.inject({ method: 'GET', url: '/family/scope-contracts' })).statusCode).toBe(
      403,
    )
    expect(
      (await app.inject({ method: 'POST', url: `/family/scope-contracts/${SCOPE}/grant` }))
        .statusCode,
    ).toBe(403)
    await app.close()
  })

  it('renders the catalogue honestly before any grant — not_granted, empty evidence', async () => {
    const app = await buildApp(ADULT)
    const res = await app.inject({ method: 'GET', url: '/family/scope-contracts' })
    expect(res.statusCode).toBe(200)
    const [c] = res.json().contracts
    expect(c).toMatchObject({
      scope_id: SCOPE,
      state: 'not_granted',
      enabled: false,
      scope_class: 'notification',
      template_version: 1,
    })
    expect(c.terms_text).toContain('renewal')
    await app.close()
  })

  it('grant writes the artifact AND the enforcement flag — the contract is the control', async () => {
    const app = await buildApp(ADULT)
    const res = await app.inject({ method: 'POST', url: `/family/scope-contracts/${SCOPE}/grant` })
    expect(res.statusCode).toBe(200)
    expect(res.json().contract.state).toBe('granted')

    expect(await flag()).toBe(true)
    const c = await contract()
    expect(c?.['granted_by']).toBe(ADULT)
    expect(c?.['history']).toEqual([expect.objectContaining({ event: 'granted', actor: ADULT })])
    await app.close()
  })

  it('collapse turns the flag off and records who and why', async () => {
    const app = await buildApp(ADULT)
    await app.inject({ method: 'POST', url: `/family/scope-contracts/${SCOPE}/grant` })
    const res = await app.inject({
      method: 'POST',
      url: `/family/scope-contracts/${SCOPE}/collapse`,
      payload: { reason: 'too noisy' },
    })
    expect(res.statusCode).toBe(200)

    expect(await flag()).toBe(false)
    const c = await contract()
    expect(c?.['state']).toBe('collapsed')
    expect(c?.['collapsed_by']).toBe(ADULT)
    expect(c?.['collapse_reason']).toBe('too noisy')
    await app.close()
  })

  it('a suspended scope resumes only through a new explicit grant', async () => {
    // Grant, then plant enough failed reminders to trip the incident check.
    const app = await buildApp(ADULT)
    await app.inject({ method: 'POST', url: `/family/scope-contracts/${SCOPE}/grant` })
    const failedDocs = Array.from({ length: SUSPEND_AFTER_CONSECUTIVE_FAILURES }, (_, i) => ({
      id: `r-${i}`,
      tenant_id: TENANT,
      kind: 'policy_renewal',
      status: 'failed',
      updated_at: new Date(),
    }))
    await db.collection('reminders').insertMany(failedDocs)

    expect(await maybeSuspendScopeOnFailures(db, TENANT)).toBe(true)
    expect(await flag()).toBe(false)

    const res = await app.inject({ method: 'GET', url: '/family/scope-contracts' })
    const [c] = res.json().contracts
    expect(c.state).toBe('suspended')
    expect(c.suspend_reason).toBe('repeated_delivery_failure')
    expect(c.adjustments).toEqual([
      expect.objectContaining({ kind: 'downward', reason: 'repeated_delivery_failure' }),
    ])

    // Re-grant is explicit — the contract never widens itself back.
    await app.inject({ method: 'POST', url: `/family/scope-contracts/${SCOPE}/grant` })
    expect(await flag()).toBe(true)
    const after = await contract()
    expect(after?.['state']).toBe('granted')
    // The downward adjustment stays on the record — history is append-only.
    expect(after?.['adjustments']).toHaveLength(1)
    await app.close()
  })

  it('fewer failures than the threshold leave the grant alone', async () => {
    const app = await buildApp(ADULT)
    await app.inject({ method: 'POST', url: `/family/scope-contracts/${SCOPE}/grant` })
    await db.collection('reminders').insertOne({
      id: 'r-1',
      tenant_id: TENANT,
      kind: 'policy_renewal',
      status: 'failed',
      updated_at: new Date(),
    })
    expect(await maybeSuspendScopeOnFailures(db, TENANT)).toBe(false)
    expect(await flag()).toBe(true)
    await app.close()
  })

  it('the settings PATCH stays in sync — a flag flip is a contract event', async () => {
    const app = await buildApp(ADULT)
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { renewal_reminders_enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().renewal_reminders_enabled).toBe(true)

    const c = await contract()
    expect(c?.['state']).toBe('granted')
    expect(c?.['granted_by']).toBe(ADULT)
    await app.close()
  })

  it('evidence renders from real reminder records', async () => {
    const app = await buildApp(ADULT)
    await db.collection('reminders').insertMany([
      { id: 'a', tenant_id: TENANT, kind: 'policy_renewal', status: 'sent' },
      { id: 'b', tenant_id: TENANT, kind: 'policy_renewal', status: 'sent' },
      { id: 'c', tenant_id: TENANT, kind: 'policy_renewal', status: 'scheduled' },
      { id: 'd', tenant_id: 'other-tenant', kind: 'policy_renewal', status: 'sent' },
    ])
    const res = await app.inject({ method: 'GET', url: '/family/scope-contracts' })
    const [c] = res.json().contracts
    expect(c.evidence).toEqual({ sent: 2, scheduled: 1 })
    await app.close()
  })

  it('unknown scopes 404 on grant and collapse', async () => {
    const app = await buildApp(ADULT)
    expect(
      (await app.inject({ method: 'POST', url: '/family/scope-contracts/nope/grant' })).statusCode,
    ).toBe(404)
    expect(
      (await app.inject({ method: 'POST', url: '/family/scope-contracts/nope/collapse' }))
        .statusCode,
    ).toBe(404)
    await app.close()
  })
})
