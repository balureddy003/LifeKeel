/**
 * Family Group Routes — persists the family roster (name, invite code,
 * members) server-side. One family per tenant. Members are roster records
 * (name/email/role) attached to the organizer's own account, not separate
 * logins — a partner/child does not authenticate independently today. See
 * apps/family/src/lib/auth-context.tsx for the client side of this.
 *
 * GET    /family              — the tenant's family, or { family: null }
 * POST   /family               — create (409 if one already exists)
 * PATCH  /family                — rename
 * POST   /family/members        — add a member
 * PATCH  /family/members/:id     — update a member's role
 * DELETE /family/members/:id      — remove a member
 *
 * Security: all routes require JWT auth. tenant_id from JWT, never from body.
 * Data access goes through TenantScopedCollection (ADR-0065) — every query
 * is auto-scoped to the caller's tenant_id, not a raw unscoped lookup.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID, randomBytes } from 'node:crypto'
import { createLogger, getTenantCollection } from '@kairos/platform'
import { getFamilyGroupsCollection } from '../db.js'

const log = createLogger({ service: 'family-group', version: '0.0.0' })

type FamilyRole = 'organizer' | 'parent' | 'adult' | 'child'

interface FamilyMemberDoc {
  id: string
  name: string
  email: string
  role: FamilyRole
  status: 'active' | 'pending'
  joined_at: string
}

interface FamilyGroupDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  name: string
  invite_code: string
  members: FamilyMemberDoc[]
  created_at: Date
  updated_at: Date
}

interface UserDoc extends Record<string, unknown> {
  id: string
  name?: string
  email?: string
}

function toResponse(doc: FamilyGroupDoc) {
  return {
    id: doc.id,
    name: doc.name,
    inviteCode: doc.invite_code,
    members: doc.members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      status: m.status,
      joinedAt: m.joined_at,
    })),
  }
}

function generateInviteCode(): string {
  return randomBytes(4).toString('hex').toUpperCase().slice(0, 6)
}

export function registerFamilyGroupRoutes(fastify: FastifyInstance, db: Db): void {
  // Index setup only — the raw accessor lives in db.ts (infra-allowed);
  // every query below goes through the tenant-scoped wrapper instead.
  const rawGroups = getFamilyGroupsCollection(db)
  rawGroups.createIndex({ tenant_id: 1 }, { unique: true }).catch(() => {})
  rawGroups.createIndex({ invite_code: 1 }, { unique: true }).catch(() => {})

  const groupsFor = (tenantId: string) => getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId)

  // ── GET /family ──────────────────────────────────────────────────────────
  fastify.get('/family', async (req) => {
    const { tenant_id } = req.authContext
    const doc = await groupsFor(tenant_id).findOne({})
    return { family: doc ? toResponse(doc) : null }
  })

  // ── POST /family ─────────────────────────────────────────────────────────
  fastify.post<{ Body: { name: string } }>('/family', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const name = req.body?.name?.trim()
    if (!name) return reply.status(400).send({ error: 'Family name required' })

    const groups = groupsFor(tenant_id)
    const existing = await groups.findOne({})
    if (existing) return reply.status(409).send({ error: 'Family already exists for this account' })

    const owner = await getTenantCollection<UserDoc>(db, 'users', tenant_id).findOne({ id: user_id })

    const doc: FamilyGroupDoc = {
      id: `family-${randomUUID()}`,
      tenant_id,
      name,
      invite_code: generateInviteCode(),
      members: [
        {
          id: user_id,
          name: owner?.name ?? 'Organizer',
          email: owner?.email ?? '',
          role: 'organizer',
          status: 'active',
          joined_at: new Date().toISOString(),
        },
      ],
      created_at: new Date(),
      updated_at: new Date(),
    }

    try {
      await groups.insertOne(doc)
    } catch {
      // Unique index race — another request for this tenant created one first.
      return reply.status(409).send({ error: 'Family already exists for this account' })
    }

    log.info({ tenant_id, familyId: doc.id }, 'Family created')
    return reply.status(201).send({ family: toResponse(doc) })
  })

  // ── PATCH /family ────────────────────────────────────────────────────────
  fastify.patch<{ Body: { name: string } }>('/family', async (req, reply) => {
    const { tenant_id } = req.authContext
    const name = req.body?.name?.trim()
    if (!name) return reply.status(400).send({ error: 'Family name required' })

    const result = (await groupsFor(tenant_id).findOneAndUpdate(
      {},
      { $set: { name, updated_at: new Date() } },
      { returnDocument: 'after' },
    )) as FamilyGroupDoc | null
    if (!result) return reply.status(404).send({ error: 'Family not found' })
    return { family: toResponse(result) }
  })

  // ── POST /family/members ────────────────────────────────────────────────
  fastify.post<{ Body: { name: string; email: string; role: FamilyRole } }>(
    '/family/members',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { name, email, role } = req.body ?? ({} as { name: string; email: string; role: FamilyRole })
      if (!name?.trim() || !role) return reply.status(400).send({ error: 'Member name and role required' })

      const member: FamilyMemberDoc = {
        id: randomUUID(),
        name: name.trim(),
        email: email?.trim() ?? '',
        role,
        status: 'pending',
        joined_at: new Date().toISOString(),
      }

      const result = (await groupsFor(tenant_id).findOneAndUpdate(
        {},
        { $push: { members: member }, $set: { updated_at: new Date() } },
        { returnDocument: 'after' },
      )) as FamilyGroupDoc | null
      if (!result) return reply.status(404).send({ error: 'Family not found — create one first' })
      return reply.status(201).send({ family: toResponse(result) })
    },
  )

  // ── PATCH /family/members/:id ───────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { role: FamilyRole } }>(
    '/family/members/:id',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { role } = req.body ?? ({} as { role: FamilyRole })
      if (!role) return reply.status(400).send({ error: 'Role required' })

      const result = (await groupsFor(tenant_id).findOneAndUpdate(
        { 'members.id': req.params.id },
        { $set: { 'members.$.role': role, updated_at: new Date() } },
        { returnDocument: 'after' },
      )) as FamilyGroupDoc | null
      if (!result) return reply.status(404).send({ error: 'Member not found' })
      return { family: toResponse(result) }
    },
  )

  // ── DELETE /family/members/:id ──────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/family/members/:id', async (req, reply) => {
    const { tenant_id } = req.authContext

    const result = (await groupsFor(tenant_id).findOneAndUpdate(
      {},
      { $pull: { members: { id: req.params.id } }, $set: { updated_at: new Date() } },
      { returnDocument: 'after' },
    )) as FamilyGroupDoc | null
    if (!result) return reply.status(404).send({ error: 'Family not found' })

    log.info({ tenant_id, memberId: req.params.id }, 'Family member removed')
    return { family: toResponse(result) }
  })
}
