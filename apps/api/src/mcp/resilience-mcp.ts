/**
 * Read-only MCP endpoint (intent 96). Lets the signed-in adult's own AI client ask for the household's
 * resilience estimate. JSON-RPC 2.0 over POST /mcp, behind the normal authentication.
 *
 * Tier 0: one tool, read-only, no write, no action, no model call. Same visibility rule as the web route
 * (`resilienceForUser`: adults only, fails closed). Off unless explicitly enabled, because it hands family
 * figures to whichever client the person connects; CLAUDE.md rule 3 means that must be the person's own
 * choice, never a default.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { resilienceForUser } from '../routes/family-resilience.js'

const PROTOCOL_VERSION = '2025-06-18'
const TOOL = 'get_resilience_estimate'

const TOOL_DEFINITION = {
  name: TOOL,
  title: 'Household resilience estimate',
  description:
    "The household's own estimate of how many months its savings, income protection and cover would last if the main income stopped. " +
    'An estimate from figures the household entered, with what it leaves out and what to check next. Not advice.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string }
}

const ok = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: RpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
})

export function registerMcpRoutes(app: FastifyInstance, db: Db, opts: { enabled: boolean }): void {
  if (!opts.enabled) return
  app.post('/mcp', async (req, reply) => {
    const body = req.body as RpcRequest | null
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string')
      return reply.status(400).send(fail(null, -32600, 'Invalid request'))
    // A notification has no id and gets no reply body.
    if (body.id === undefined) return reply.status(202).send()

    switch (body.method) {
      case 'initialize':
        return ok(body.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'lifekeel', version: '0.1.0' },
        })
      case 'ping':
        return ok(body.id, {})
      case 'tools/list':
        return ok(body.id, { tools: [TOOL_DEFINITION] })
      case 'tools/call': {
        if (body.params?.name !== TOOL) return fail(body.id, -32602, 'Unknown tool')
        const { tenant_id, user_id } = req.authContext
        const view = await resilienceForUser(db, tenant_id, user_id)
        if (!view)
          return ok(body.id, {
            isError: true,
            content: [{ type: 'text', text: 'Only adults in this family can see this.' }],
          })
        return ok(body.id, { content: [{ type: 'text', text: JSON.stringify(view) }] })
      }
      default:
        return fail(body.id, -32601, 'Method not found')
    }
  })
}
