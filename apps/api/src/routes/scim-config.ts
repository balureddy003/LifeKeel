/**
 * SCIM Configuration Routes
 *
 * Provides SCIM configuration management for enterprise tenants.
 * Includes SCIM bearer token management and sync status.
 *
 * ADR-0028: SSO and Enterprise Auth - SCIM endpoints
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'

const ScimConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bearer_token: z.string().optional(),
  sync_status: z.enum(['active', 'paused', 'error']).default('paused'),
  last_sync_at: z.string().optional(),
  sync_errors: z.number().int().default(0),
})

export function registerScimConfigRoutes(app: FastifyInstance, db: Db): void {
  // GET /admin/tenants/:tenantId/scim-config - Get SCIM configuration
  app.get('/admin/tenants/:tenantId/scim-config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string }

    // Verify admin access
    if (!req.authContext.roles.includes('admin') || req.authContext.tenant_id !== tenantId) {
      return reply.status(403).send({ error: 'Admin access required' })
    }

    const tenant = await db.collection('tenants').findOne({
      $or: [{ tenant_id: tenantId }, { id: tenantId }],
    })

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const scimConfig = (tenant['scim_config'] as Record<string, unknown> | undefined) || {
      enabled: false,
      sync_status: 'paused',
      sync_errors: 0,
    }

    return reply.send(scimConfig)
  })

  // PUT /admin/tenants/:tenantId/scim-config - Update SCIM configuration
  app.put('/admin/tenants/:tenantId/scim-config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string }

    // Verify admin access
    if (!req.authContext.roles.includes('admin') || req.authContext.tenant_id !== tenantId) {
      return reply.status(403).send({ error: 'Admin access required' })
    }

    const parsed = ScimConfigSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid SCIM config', issues: parsed.error.issues })
    }

    const config = parsed.data

    // If enabling SCIM, generate a bearer token if not provided
    if (config.enabled && !config.bearer_token) {
      config.bearer_token = generateScimToken()
    }

    // If disabling SCIM, clear the bearer token
    if (!config.enabled) {
      config.bearer_token = undefined
    }

    await db.collection('tenants').updateOne(
      { $or: [{ tenant_id: tenantId }, { id: tenantId }] },
      {
        $set: {
          scim_config: config,
          updated_at: new Date(),
        },
      },
      { upsert: true },
    )

    return reply.send(config)
  })

  // POST /admin/tenants/:tenantId/scim-config/rotate-token - Rotate SCIM bearer token
  app.post('/admin/tenants/:tenantId/scim-config/rotate-token', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string }

    // Verify admin access
    if (!req.authContext.roles.includes('admin') || req.authContext.tenant_id !== tenantId) {
      return reply.status(403).send({ error: 'Admin access required' })
    }

    const tenant = await db.collection('tenants').findOne({
      $or: [{ tenant_id: tenantId }, { id: tenantId }],
    })

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const scimConfig = (tenant['scim_config'] as Record<string, unknown> | undefined) || {}
    if (!scimConfig.enabled) {
      return reply.status(400).send({ error: 'SCIM is not enabled for this tenant' })
    }

    const newToken = generateScimToken()

    await db.collection('tenants').updateOne(
      { $or: [{ tenant_id: tenantId }, { id: tenantId }] },
      {
        $set: {
          'scim_config.bearer_token': newToken,
          'scim_config.token_rotated_at': new Date(),
          updated_at: new Date(),
        },
      },
    )

    return reply.send({
      bearer_token: newToken,
      rotated_at: new Date(),
    })
  })

  // GET /admin/tenants/:tenantId/scim-config/sync-status - Get SCIM sync status
  app.get('/admin/tenants/:tenantId/scim-config/sync-status', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string }

    // Verify admin access
    if (!req.authContext.roles.includes('admin') || req.authContext.tenant_id !== tenantId) {
      return reply.status(403).send({ error: 'Admin access required' })
    }

    const tenant = await db.collection('tenants').findOne({
      $or: [{ tenant_id: tenantId }, { id: tenantId }],
    })

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const scimConfig = (tenant['scim_config'] as Record<string, unknown> | undefined) || {}

    // Get sync statistics
    const userCount = await db.collection('users').countDocuments({
      tenant_id: tenantId,
      identity_source: 'scim',
    })

    const groupCount = await db.collection('groups').countDocuments({
      tenant_id: tenantId,
    })

    return reply.send({
      enabled: scimConfig.enabled || false,
      sync_status: scimConfig.sync_status || 'paused',
      last_sync_at: scimConfig.last_sync_at,
      sync_errors: scimConfig.sync_errors || 0,
      scim_user_count: userCount,
      scim_group_count: groupCount,
    })
  })
}

function generateScimToken(): string {
  // Generate a cryptographically random SCIM bearer token
  const crypto = require('node:crypto')
  return crypto.randomBytes(32).toString('hex')
}
