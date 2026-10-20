/**
 * GET /family/channels (PRD-140) — which delivery channels have a working
 * device, what failed recently, and where the next alert goes first. Adults
 * only. Counts and platform names; never tokens or endpoints.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { isFamilyAdult } from '../family/family-permissions.js'
import { getChannelState } from '../delivery/channel-state.js'

export function registerFamilyChannelRoutes(app: FastifyInstance, db: Db): void {
  app.get('/family/channels', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Only adults can see this' })
    }
    return getChannelState(db, tenant_id)
  })
}
