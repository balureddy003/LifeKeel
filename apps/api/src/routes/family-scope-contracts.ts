/**
 * /family/scope-contracts — Earned-Scope Contracts (PRD-214, M5).
 *
 *   GET  /family/scope-contracts                      — the catalogue, rendered
 *                                                       from real records
 *   POST /family/scope-contracts/:scopeId/grant       — the explicit family yes
 *   POST /family/scope-contracts/:scopeId/collapse    — one action, it stops
 *
 * Adult members only — a youth twin never sees (or controls) the household's
 * autonomy grants. Grant/collapse write the same enforcement flag the send
 * path re-checks, so the contract is the control, not a label for one.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { isFamilyAdult } from '../family/family-permissions.js'
import {
  SCOPE_CATALOGUE,
  grantScope,
  collapseScope,
  listScopeContractViews,
} from '../family/scope-contracts.js'

export function registerFamilyScopeContractRoutes(app: FastifyInstance, db: Db): void {
  const adultOnly = async (request: { authContext: { tenant_id: string; user_id: string } }) => {
    const { tenant_id, user_id } = request.authContext
    return isFamilyAdult(db, tenant_id, user_id)
  }

  app.get('/family/scope-contracts', async (request, reply) => {
    if (!(await adultOnly(request))) {
      return reply
        .status(403)
        .send({ error: 'Scope contracts are visible to adult family members only.' })
    }
    return { contracts: await listScopeContractViews(db, request.authContext.tenant_id) }
  })

  app.post<{ Params: { scopeId: string } }>(
    '/family/scope-contracts/:scopeId/grant',
    async (request, reply) => {
      if (!(await adultOnly(request))) {
        return reply.status(403).send({ error: 'Only an adult family member can grant a scope.' })
      }
      const { scopeId } = request.params
      if (!SCOPE_CATALOGUE[scopeId]) {
        return reply.status(404).send({ error: `Unknown scope '${scopeId}'` })
      }
      const { tenant_id, user_id } = request.authContext
      const contract = await grantScope(db, tenant_id, scopeId, user_id, request)
      return { contract }
    },
  )

  app.post<{ Params: { scopeId: string }; Body: { reason?: string } }>(
    '/family/scope-contracts/:scopeId/collapse',
    async (request, reply) => {
      if (!(await adultOnly(request))) {
        return reply
          .status(403)
          .send({ error: 'Only an adult family member can collapse a scope.' })
      }
      const { scopeId } = request.params
      if (!SCOPE_CATALOGUE[scopeId]) {
        return reply.status(404).send({ error: `Unknown scope '${scopeId}'` })
      }
      const reason = request.body?.reason
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) {
        return reply
          .status(400)
          .send({ error: 'reason must be a string of at most 500 characters' })
      }
      const { tenant_id, user_id } = request.authContext
      const contract = await collapseScope(db, tenant_id, scopeId, user_id, reason, request)
      return { contract }
    },
  )
}
