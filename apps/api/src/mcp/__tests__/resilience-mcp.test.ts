/**
 * Read-only MCP endpoint (intent 96). Exposes the household's own resilience estimate to the signed-in
 * adult's own AI client. Same visibility rule as the web route: adults only, fails closed. Off by default.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerMcpRoutes } from '../resilience-mcp.js'

const TENANT = 't-mcp'
let profile: Record<string, unknown> | null
let family: Record<string, unknown> | null
const writes: string[] = []

const col = (store: Record<string, unknown>[]) => ({
  createIndex: async () => '',
  findOne: async () => store[0] ?? null,
  find: () => ({ toArray: async () => [] }),
  insertOne: async () => {
    writes.push('insert')
    return {}
  },
})
const db = () =>
  ({
    collection: (name: string) =>
      name === 'family_financial_profile'
        ? col(profile ? [profile] : [])
        : name === 'family_groups'
          ? col(family ? [family] : [])
          : col([]),
  }) as never

async function appFor(user_id: string, enabled = true) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = {
      tenant_id: TENANT,
      user_id,
      roles: ['member'],
    }
  })
  registerMcpRoutes(app, db(), { enabled })
  return app
}
const rpc = async (user: string, body: unknown, enabled = true) =>
  (await appFor(user, enabled)).inject({ method: 'POST', url: '/mcp', payload: body as object })

beforeEach(() => {
  writes.length = 0
  profile = {
    tenant_id: TENANT,
    household: { monthly_salary_minor: 300_000, income_protection_monthly_minor: 0 },
    emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
  }
  family = {
    tenant_id: TENANT,
    members: [
      { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
      { id: 'kid', name: 'Kit', role: 'child', status: 'active' },
    ],
  }
})

describe('POST /mcp', () => {
  it('is not there when the flag is off', async () => {
    const res = await rpc('u1', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, false)
    expect(res.statusCode).toBe(404)
  })

  it('answers initialize with tools only', async () => {
    const res = await rpc('u1', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const r = res.json().result
    expect(r.capabilities).toEqual({ tools: {} })
    expect(r.serverInfo.name).toBe('lifekeel')
    expect(typeof r.protocolVersion).toBe('string')
  })

  it('lists exactly one tool, and it is marked read-only', async () => {
    const res = await rpc('u1', { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = res.json().result.tools
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('get_resilience_estimate')
    expect(tools[0].annotations.readOnlyHint).toBe(true)
  })

  it('gives an adult the estimate, labelled as an estimate, and writes nothing', async () => {
    const res = await rpc('u1', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_resilience_estimate', arguments: {} },
    })
    const result = res.json().result
    expect(result.isError).not.toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('ready')
    expect(payload.text).toMatch(/estimate/)
    expect(writes).toEqual([])
  })

  it('gives a child nothing: an error and no figures', async () => {
    const res = await rpc('kid', {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_resilience_estimate', arguments: {} },
    })
    const result = res.json().result
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/900000|savings/i)
  })

  it('rejects an unknown tool and an unknown method', async () => {
    const t = await rpc('u1', {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'delete_everything', arguments: {} },
    })
    expect(t.json().error.code).toBe(-32602)
    const m = await rpc('u1', { jsonrpc: '2.0', id: 6, method: 'resources/read' })
    expect(m.json().error.code).toBe(-32601)
  })

  it('accepts a notification with no body in the reply', async () => {
    const res = await rpc('u1', { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.statusCode).toBe(202)
    expect(res.body).toBe('')
  })
})
