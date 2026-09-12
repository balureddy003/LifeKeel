/**
 * Workflow version history routes.
 *
 * GET  /workflows/:id/versions                  — list version history
 * GET  /workflows/:id/versions/:hash            — get specific version def
 * GET  /workflows/:id/versions/:hash/diff       — diff vs current
 * POST /workflows/:id/versions/:hash/restore    — restore a version
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { WorkflowVersionStore } from '@kairos/workflows'
import type { WorkflowLoader } from '@kairos/workflows'

export function registerVersionRoutes(fastify: FastifyInstance, db: Db, loader: WorkflowLoader): void {
  const store = new WorkflowVersionStore(db)

  // GET /workflows/:id/versions
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/workflows/:id/versions', async (req, reply) => {
      const def = loader.get(req.params.id)
      if (!def) return reply.status(404).send({ error: 'Workflow not found' })
      const limit = parseInt(req.query.limit ?? '20', 10)
      const versions = await store.listVersions(req.params.id, limit)
      return { versions, current_hash: WorkflowVersionStore.hash(def) }
    }
  )

  // GET /workflows/:id/versions/:hash
  fastify.get<{ Params: { id: string; hash: string } }>(
    '/workflows/:id/versions/:hash', async (req, reply) => {
      const version = await store.getVersion(req.params.id, req.params.hash)
      if (!version) return reply.status(404).send({ error: 'Version not found' })
      return { version }
    }
  )

  // GET /workflows/:id/versions/:hash/diff — compare version to current
  fastify.get<{ Params: { id: string; hash: string } }>(
    '/workflows/:id/versions/:hash/diff', async (req, reply) => {
      const current = loader.get(req.params.id)
      if (!current) return reply.status(404).send({ error: 'Workflow not found' })
      const version = await store.getVersion(req.params.id, req.params.hash)
      if (!version) return reply.status(404).send({ error: 'Version not found' })
      const diff = WorkflowVersionStore.diff(version.def, current)
      return {
        from: { hash: req.params.hash, saved_at: version.saved_at },
        to:   { hash: WorkflowVersionStore.hash(current), label: 'current' },
        diff,
      }
    }
  )

  // POST /workflows/:id/versions/:hash/restore
  fastify.post<{ Params: { id: string; hash: string } }>(
    '/workflows/:id/versions/:hash/restore', async (req, reply) => {
      const current = loader.get(req.params.id)
      if (current) {
        // Save current as a version before overwriting
        await store.saveVersion(current, 'restore')
      }
      const version = await store.getVersion(req.params.id, req.params.hash)
      if (!version) return reply.status(404).send({ error: 'Version not found' })
      // Restore via loader (triggers hot-reload)
      loader.saveWorkflow(version.def)
      return { ok: true, restored_hash: req.params.hash, workflow_id: req.params.id }
    }
  )
}
