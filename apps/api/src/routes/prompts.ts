import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import {
  PromptVersionRegistry,
  type PromptEvalResult,
  type PromptStatus,
} from '@kairos/platform'

export function registerPromptRoutes(app: FastifyInstance, db: Db): void {
  const registry = new PromptVersionRegistry(db)

  app.get<{ Querystring: { status?: PromptStatus; skill_id?: string; detector_id?: string } }>(
    '/prompts',
    async req => ({ versions: await registry.list(req.query) }),
  )

  app.post<{
    Body: {
      template: string
      parent_id?: string
      author?: string
      skill_id?: string
      detector_id?: string
      call_type: 'enrichment' | 'decomposition' | 'judge' | 'nlq' | 'summary'
    }
  }>('/prompts', async (req, reply) => {
    const version = await registry.createCandidate({
      template: req.body.template,
      ...(req.body.parent_id !== undefined && { parent_id: req.body.parent_id }),
      author: req.body.author ?? req.authContext.user_id,
      metadata: {
        call_type: req.body.call_type,
        ...(req.body.skill_id !== undefined && { skill_id: req.body.skill_id }),
        ...(req.body.detector_id !== undefined && { detector_id: req.body.detector_id }),
      },
    })
    return reply.status(201).send({ version })
  })

  app.post<{ Params: { id: string }; Body: PromptEvalResult }>('/prompts/:id/evals', async req => {
    await registry.addEval(req.params.id, { ...req.body, ran_at: new Date(req.body.ran_at) })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/prompts/:id/ab-test', async req => {
    await registry.startAbTest(req.params.id)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/prompts/:id/promote', async (req, reply) => {
    try {
      return { version: await registry.promote(req.params.id) }
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/prompts/:id/retire', async req => {
    await registry.retire(req.params.id)
    return { ok: true }
  })
}
