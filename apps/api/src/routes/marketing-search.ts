/**
 * /operator/marketing/search: the Search Console and GA4 read-back view (intent 47).
 *
 *   GET  /operator/marketing/search?days=28   aggregates, near misses, integration state (marketing.read)
 *   POST /operator/marketing/search/run       pull now (marketing.manage)
 *
 * Read-only toward Google; the response carries aggregates only and never a credential.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { requireOperator } from '../operator/operator-auth.js'
import {
  ensureSearchIndexes,
  runSearchReadback,
  searchView,
  type ReadbackDeps,
} from '../marketing/search-readback.js'
import { readbackPresence, readbackConfig } from '../marketing/google-read.js'

export interface MarketingSearchOptions {
  operatorTenants?: string[]
  now?: () => Date
  deps?: ReadbackDeps
}

export function registerMarketingSearchRoutes(
  app: FastifyInstance,
  db: Db,
  opts?: MarketingSearchOptions,
): void {
  ensureSearchIndexes(db)
  const now = () => opts?.now?.() ?? new Date()
  const testGate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!new Set(opts?.operatorTenants ?? []).has(req.authContext.tenant_id))
      await reply.status(403).send({ error: 'Forbidden: not an operator tenant' })
  }
  const readGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.read')
  const manageGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.manage')

  app.get<{ Querystring: { days?: string } }>(
    '/operator/marketing/search',
    { preHandler: readGate },
    async (req, reply) => {
      const days = req.query.days === undefined ? 28 : Number(req.query.days)
      if (!Number.isInteger(days) || days < 1 || days > 400)
        return reply.status(400).send({ error: 'days_must_be_1_to_400' })
      const cfg = opts?.deps?.config ?? readbackConfig()
      return { ...(await searchView(db, days, now())), configured: readbackPresence(cfg) }
    },
  )

  app.post('/operator/marketing/search/run', { preHandler: manageGate }, async () =>
    runSearchReadback(db, now(), opts?.deps ?? {}),
  )
}
