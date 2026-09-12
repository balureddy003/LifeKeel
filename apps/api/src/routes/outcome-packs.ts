/**
 * Outcome Packs API
 * 
 * GET /outcome-packs — list packs with connector readiness
 * POST /outcome-packs/:id/install — install a pack
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { loadOutcomePacks, WorkflowLoader } from '@kairos/workflows'
import { repoRoot } from '@kairos/platform'
import type { OutcomePack } from '@kairos/specifications'

interface PackWithReadiness extends OutcomePack {
  ready: boolean
  missing_connectors: string[]
}

export async function registerOutcomePackRoutes(app: FastifyInstance, db?: Db, loader?: WorkflowLoader): Promise<void> {
  const root = repoRoot()

  /**
   * GET /outcome-packs
   * Returns packs with per-tenant connector readiness
   */
  app.get('/outcome-packs', async (req) => {
    const { tenant_id } = req.authContext

    // Load pack definitions
    const packs = loadOutcomePacks(root)

    // Get connected connectors for tenant
    const connectedConnectors: string[] = []
    if (db) {
      const credentials = await db.collection('connector_credentials')
        .find({ tenant_id })
        .project({ connector_id: 1 })
        .toArray()
      connectedConnectors.push(...credentials.map(c => c['connector_id'] as string))
    }

    // Compute readiness per pack
    const packsWithReadiness: PackWithReadiness[] = packs.map(pack => {
      const missing = pack.required_connectors.filter(c => !connectedConnectors.includes(c))
      return {
        ...pack,
        ready: missing.length === 0,
        missing_connectors: missing,
      }
    })

    return { packs: packsWithReadiness }
  })

  /**
   * POST /outcome-packs/:id/install
   * Install a pack for the tenant
   */
  app.post<{ Params: { id: string } }>('/outcome-packs/:id/install', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id } = req.params

    if (!db) {
      return reply.status(503).send({ error: 'Database connection required for pack installation' })
    }

    if (!loader) {
      return reply.status(503).send({ error: 'Workflow loader not available' })
    }

    // Load pack definition
    const pack = loadOutcomePacks(root).find(p => p.id === id)
    if (!pack) {
      return reply.status(404).send({ error: `Pack not found: ${id}` })
    }

    // Check connector readiness
    const credentials = await db.collection('connector_credentials')
      .find({ tenant_id })
      .project({ connector_id: 1 })
      .toArray()
    const connectedConnectors = credentials.map(c => c['connector_id'] as string)
    const missing = pack.required_connectors.filter(c => !connectedConnectors.includes(c))

    if (missing.length > 0) {
      return reply.status(400).send({
        error: 'Required connectors not connected',
        missing_connectors: missing,
      })
    }

    // Get tenant's dry_run_mode setting
    const tenantSettings = await db.collection('tenant_settings').findOne({ tenant_id })
    const dryRunMode = tenantSettings?.['automation']?.dry_run_mode === true

    // Enable included workflows
    const enabledWorkflows: string[] = []
    for (const workflowId of pack.included_workflows) {
      const workflowDef = loader.get(workflowId)
      if (workflowDef) {
        // Enable the workflow by updating its definition
        workflowDef.enabled = true
        // Save the updated workflow definition
        loader.saveWorkflow(workflowDef, req.authContext.user_id)
        enabledWorkflows.push(workflowId)
      }
    }

    // Record installation in tenant_settings
    await db.collection('tenant_settings').updateOne(
      { tenant_id },
      {
        $set: {
          [`installed_packs.${id}`]: {
            installed_at: new Date(),
            dry_run_mode: dryRunMode,
            enabled_workflows: pack.included_workflows,
            enabled_detectors: pack.included_detectors,
          },
          updated_at: new Date(),
        },
      },
      { upsert: true }
    )

    return {
      success: true,
      pack_id: id,
      message: 'Pack installed successfully',
      dry_run_mode: dryRunMode,
      enabled_workflows: enabledWorkflows,
      enabled_detectors: pack.included_detectors,
    }
  })
}
