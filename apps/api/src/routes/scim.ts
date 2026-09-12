/**
 * SCIM 2.0 Routes
 *
 * Implements SCIM 2.0 endpoints for user and group provisioning.
 * Integrates with enterprise identity providers (Okta, Azure AD, OneLogin).
 *
 * ADR-0028: SSO and Enterprise Auth - SCIM endpoints
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { ScimService, type ScimUser, type ScimGroup } from '@kairos/platform'

const SCIM_BEARER_TOKEN = process.env['SCIM_BEARER_TOKEN'] || ''

// ── SCIM Authentication Middleware ─────────────────────────────────────────────

function validateScimToken(req: FastifyRequest, reply: FastifyReply): boolean {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Authorization Bearer token required',
    })
    return false
  }

  const token = authHeader.substring(7) // Remove 'Bearer ' prefix

  if (!SCIM_BEARER_TOKEN || token !== SCIM_BEARER_TOKEN) {
    reply.status(401).send({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Invalid SCIM bearer token',
    })
    return false
  }

  return true
}

// ── SCIM Request Schemas ───────────────────────────────────────────────────────

const ScimUserSchema = z.object({
  schemas: z.array(z.string()).default(['urn:ietf:params:scim:schemas:core:2.0:User']),
  userName: z.string().email(),
  name: z.object({
    givenName: z.string().optional(),
    familyName: z.string().optional(),
  }).optional(),
  active: z.boolean().optional(),
  emails: z.array(z.object({
    value: z.string().email(),
    primary: z.boolean().optional(),
    type: z.string().optional(),
  })).optional(),
  displayName: z.string().optional(),
  externalId: z.string().optional(),
})

const ScimGroupSchema = z.object({
  schemas: z.array(z.string()).default(['urn:ietf:params:scim:schemas:core:2.0:Group']),
  displayName: z.string(),
  members: z.array(z.object({
    value: z.string(),
    display: z.string().optional(),
  })).optional(),
})

// ── SCIM Routes ───────────────────────────────────────────────────────────────

export function registerScimRoutes(app: FastifyInstance, db: Db): void {
  const baseUrl = `${process.env['API_BASE_URL'] || 'http://localhost:3001'}/scim/v2`
  const scimService = new ScimService({ baseUrl })

  // ── User Endpoints ─────────────────────────────────────────────────────────────

  // GET /scim/v2/Users - List users
  app.get('/scim/v2/Users', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const query = req.query as { startIndex?: string; count?: string; filter?: string }
    const startIndex = Number(query.startIndex || 1)
    const count = Number(query.count || 100)

    const options: { startIndex?: number; count?: number; filter?: string } = {
      startIndex,
      count,
    }
    if (query.filter !== undefined) {
      options.filter = query.filter
    }

    try {
      const result = await scimService.listUsers(req.authContext.tenant_id, db, options)
      return reply.send(result)
    } catch (err) {
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: (err as Error).message,
      })
    }
  })

  // GET /scim/v2/Users/:id - Get user
  app.get('/scim/v2/Users/:id', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const { id } = req.params as { id: string }

    try {
      const user = await scimService.getUser(req.authContext.tenant_id, id, db)
      if (!user) {
        return reply.status(404).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: 'User not found',
        })
      }
      return reply.send(user)
    } catch (err) {
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: (err as Error).message,
      })
    }
  })

  // POST /scim/v2/Users - Create user
  app.post('/scim/v2/Users', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const parsed = ScimUserSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '400',
        detail: 'Invalid SCIM user',
        invalidFields: parsed.error.issues,
      })
    }

    try {
      const user = await scimService.createUser(req.authContext.tenant_id, parsed.data as ScimUser, db)
      return reply.status(201).send(user)
    } catch (err) {
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: (err as Error).message,
      })
    }
  })

  // PUT /scim/v2/Users/:id - Update user (full replace)
  app.put('/scim/v2/Users/:id', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const { id } = req.params as { id: string }
    const parsed = ScimUserSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '400',
        detail: 'Invalid SCIM user',
        invalidFields: parsed.error.issues,
      })
    }

    try {
      const user = await scimService.updateUser(req.authContext.tenant_id, id, parsed.data as ScimUser, db)
      return reply.send(user)
    } catch (err) {
      const error = err as Error
      if (error.message === 'User not found') {
        return reply.status(404).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: error.message,
        })
      }
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: error.message,
      })
    }
  })

  // PATCH /scim/v2/Users/:id - Update user (partial)
  app.patch('/scim/v2/Users/:id', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const { id } = req.params as { id: string }
    const body = req.body as { Operations?: Array<{ op: string; path: string; value: unknown }> }
    const operations = body.Operations

    if (!Array.isArray(operations)) {
      return reply.status(400).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '400',
        detail: 'Invalid patch operations',
      })
    }

    try {
      const user = await scimService.patchUser(req.authContext.tenant_id, id, operations, db)
      return reply.send(user)
    } catch (err) {
      const error = err as Error
      if (error.message === 'User not found') {
        return reply.status(404).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: error.message,
        })
      }
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: error.message,
      })
    }
  })

  // DELETE /scim/v2/Users/:id - Delete user
  app.delete('/scim/v2/Users/:id', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const { id } = req.params as { id: string }

    try {
      await scimService.deleteUser(req.authContext.tenant_id, id, db)
      return reply.status(204).send()
    } catch (err) {
      const error = err as Error
      if (error.message === 'User not found') {
        return reply.status(404).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: error.message,
        })
      }
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: error.message,
      })
    }
  })

  // ── Group Endpoints ────────────────────────────────────────────────────────────

  // GET /scim/v2/Groups - List groups
  app.get('/scim/v2/Groups', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const query = req.query as { startIndex?: string; count?: string }
    const startIndex = Number(query.startIndex || 1)
    const count = Number(query.count || 100)

    try {
      const result = await scimService.listGroups(req.authContext.tenant_id, db, {
        startIndex,
        count,
      })
      return reply.send(result)
    } catch (err) {
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: (err as Error).message,
      })
    }
  })

  // GET /scim/v2/Groups/:id - Get group
  app.get('/scim/v2/Groups/:id', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const { id } = req.params as { id: string }

    try {
      const group = await scimService.getGroup(req.authContext.tenant_id, id, db)
      if (!group) {
        return reply.status(404).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: 'Group not found',
        })
      }
      return reply.send(group)
    } catch (err) {
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: (err as Error).message,
      })
    }
  })

  // POST /scim/v2/Groups - Create group
  app.post('/scim/v2/Groups', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const parsed = ScimGroupSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '400',
        detail: 'Invalid SCIM group',
        invalidFields: parsed.error.issues,
      })
    }

    try {
      const group = await scimService.createGroup(req.authContext.tenant_id, parsed.data as ScimGroup, db)
      return reply.status(201).send(group)
    } catch (err) {
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: (err as Error).message,
      })
    }
  })

  // PUT /scim/v2/Groups/:id - Update group
  app.put('/scim/v2/Groups/:id', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const { id } = req.params as { id: string }
    const parsed = ScimGroupSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '400',
        detail: 'Invalid SCIM group',
        invalidFields: parsed.error.issues,
      })
    }

    try {
      const group = await scimService.updateGroup(req.authContext.tenant_id, id, parsed.data as ScimGroup, db)
      return reply.send(group)
    } catch (err) {
      const error = err as Error
      if (error.message === 'Group not found') {
        return reply.status(404).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: error.message,
        })
      }
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: error.message,
      })
    }
  })

  // DELETE /scim/v2/Groups/:id - Delete group
  app.delete('/scim/v2/Groups/:id', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const { id } = req.params as { id: string }

    try {
      await scimService.deleteGroup(req.authContext.tenant_id, id, db)
      return reply.status(204).send()
    } catch (err) {
      const error = err as Error
      if (error.message === 'Group not found') {
        return reply.status(404).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
          status: '404',
          detail: error.message,
        })
      }
      reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: error.message,
      })
    }
  })

  // ── Service Provider Configuration ─────────────────────────────────────────────

  // GET /scim/v2/ServiceProviderConfig - SCIM service provider config
  app.get('/scim/v2/ServiceProviderConfig', async (req, reply) => {
    if (!validateScimToken(req, reply)) return

    const config = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: {
        supported: true,
      },
      bulk: {
        supported: false,
      },
      filter: {
        supported: true,
        maxResults: 100,
      },
      changePassword: {
        supported: false,
      },
      sort: {
        supported: false,
      },
      authenticationSchemes: [
        {
          name: 'OAuth Bearer Token',
          description: 'Authentication using Bearer token',
          specUri: 'http://www.rfc-editor.org/info/rfc6750',
          type: 'bearer',
          primary: true,
        },
      ],
      etag: {
        supported: false,
      },
    }

    return reply.send(config)
  })
}
