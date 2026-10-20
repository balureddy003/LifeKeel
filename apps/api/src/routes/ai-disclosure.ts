/**
 * GET /ai/processors (PRD-142 amendment 3) — which processors can receive
 * content for which task, and whether their terms have been reviewed.
 * Authenticated, any family member: it describes the platform, not the family.
 */
import type { FastifyInstance } from 'fastify'
import { buildAiDisclosure } from '../ai/disclosure.js'
import { getProcessorRegistry, getTaskRegistry } from '../ai/task-gateway.js'

export function registerAiDisclosureRoutes(app: FastifyInstance): void {
  app.get('/ai/processors', async (_req, reply) => {
    const processors = getProcessorRegistry()
    const tasks = getTaskRegistry()
    if (processors.size === 0 || tasks.size === 0) {
      return reply.status(503).send({ error: 'AI registries are not loaded' })
    }
    return buildAiDisclosure(tasks, processors)
  })
}
