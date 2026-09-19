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
 * PATCH  /family/members/:id     — update a member's role and/or date of birth
 * DELETE /family/members/:id      — remove a member
 *
 * Security: all routes require JWT auth. tenant_id from JWT, never from body.
 * Data access goes through TenantScopedCollection (ADR-0065) — every query
 * is auto-scoped to the caller's tenant_id, not a raw unscoped lookup.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID, randomBytes } from 'node:crypto'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import { getFamilyGroupsCollection } from '../db.js'
import { isFamilyOrganizer } from '../lib/family-permissions.js'

const log = createLogger({ service: 'family-group', version: '0.0.0' })

export type FamilyRole = 'organizer' | 'parent' | 'adult' | 'child'
// Neither POST /family/members nor PATCH /family/members/:id runtime-checked
// this — `role` was only ever TypeScript-typed, which doesn't exist at
// request time, so any string round-tripped straight into the stored
// member. Confirmed live: a member persisted with an out-of-enum role value
// has no ROLE_LABELS/ROLE_BRANCHES entry on the frontend, so their card
// silently renders with no label and no sections ("Nothing set up") —
// exactly the failure mode a clean 400 here should have prevented.
const VALID_ROLES: readonly FamilyRole[] = ['organizer', 'parent', 'adult', 'child']

// Strict 'YYYY-MM-DD' + a real calendar date (rejects '2024-02-30') and not
// in the future — a birthdate can't post-date "today."
function isValidDateOfBirth(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  if (d.toISOString().slice(0, 10) !== value) return false
  return d.getTime() <= Date.now()
}

// Exported for family-join.ts (PRD-110) — an approved join request pushes a
// member here with `id` set to the new user's real `users.id`, exactly
// mirroring how the organizer's own entry is `id: user_id` at family
// creation below. That's what lets a single "does this authenticated
// user's id match a roster entry with role 'organizer'" check work for
// both, with no separate role-linking field needed.
export interface FamilyMemberDoc {
  id: string
  name: string
  email: string
  role: FamilyRole
  status: 'active' | 'pending'
  joined_at: string
  // Optional, ISO 'YYYY-MM-DD'. Added so the app can derive age and, for
  // children, years-until-university instead of asking for those as raw
  // numbers that go stale — see docs/prd (financial-profile wizard).
  // Deliberately not required at creation: captured later via PATCH, at
  // the point it's actually needed (progressive disclosure).
  date_of_birth?: string
}

export interface FamilyGroupDoc extends Record<string, unknown> {
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
      ...(m.date_of_birth ? { dateOfBirth: m.date_of_birth } : {}),
    })),
  }
}

// Exported for family-join.ts (PRD-110): resetting the invite code reuses
// the exact same generator, not a second drifting implementation.
export function generateInviteCode(): string {
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

    if (!await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)) return reply.status(403).send({ error: 'Only the organizer can manage the family' })
    const result = (await groupsFor(tenant_id).findOneAndUpdate(
      {},
      { $set: { name, updated_at: new Date() } },
      { returnDocument: 'after' },
    )) as FamilyGroupDoc | null
    if (!result) return reply.status(404).send({ error: 'Family not found' })
    return { family: toResponse(result) }
  })

  // ── POST /family/members ────────────────────────────────────────────────
  fastify.post<{ Body: { name: string; email: string; role: FamilyRole; date_of_birth?: string } }>(
    '/family/members',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { name, email, role, date_of_birth } =
        req.body ?? ({} as { name: string; email: string; role: FamilyRole; date_of_birth?: string })
      if (!name?.trim() || !role) return reply.status(400).send({ error: 'Member name and role required' })
      if (!VALID_ROLES.includes(role)) {
        return reply.status(400).send({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` })
      }
      if (date_of_birth && !isValidDateOfBirth(date_of_birth)) {
        return reply.status(400).send({ error: "Invalid date of birth. Use 'YYYY-MM-DD', not in the future." })
      }

      if (!await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)) return reply.status(403).send({ error: 'Only the organizer can manage the family' })
      const member: FamilyMemberDoc = {
        id: randomUUID(),
        name: name.trim(),
        email: email?.trim() ?? '',
        role,
        status: 'pending',
        joined_at: new Date().toISOString(),
        ...(date_of_birth ? { date_of_birth } : {}),
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
  // Accepts role and/or date_of_birth — the only two mutable fields on a
  // roster member today (name/email are set once, at invite time). At
  // least one must be present.
  fastify.patch<{ Params: { id: string }; Body: { role?: FamilyRole; date_of_birth?: string } }>(
    '/family/members/:id',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { role, date_of_birth } = req.body ?? ({} as { role?: FamilyRole; date_of_birth?: string })
      if (role === undefined && date_of_birth === undefined) {
        return reply.status(400).send({ error: 'role or date_of_birth required' })
      }
      if (role !== undefined && !VALID_ROLES.includes(role)) {
        return reply.status(400).send({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` })
      }
      if (date_of_birth !== undefined && !isValidDateOfBirth(date_of_birth)) {
        return reply.status(400).send({ error: "Invalid date of birth. Use 'YYYY-MM-DD', not in the future." })
      }

      if (!await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)) return reply.status(403).send({ error: 'Only the organizer can manage the family' })
      if (req.params.id === req.authContext.user_id && role !== undefined && role !== 'organizer') return reply.status(409).send({ error: 'An organizer cannot remove their own role' })
      const set: Record<string, unknown> = { updated_at: new Date() }
      if (role !== undefined) set['members.$.role'] = role
      if (date_of_birth !== undefined) set['members.$.date_of_birth'] = date_of_birth

      const result = (await groupsFor(tenant_id).findOneAndUpdate(
        { 'members.id': req.params.id },
        { $set: set },
        { returnDocument: 'after' },
      )) as FamilyGroupDoc | null
      if (!result) return reply.status(404).send({ error: 'Member not found' })
      return { family: toResponse(result) }
    },
  )

  // ── DELETE /family/members/:id ──────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/family/members/:id', async (req, reply) => {
    const { tenant_id } = req.authContext

    if (!await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)) return reply.status(403).send({ error: 'Only the organizer can manage the family' })
    if (req.params.id === req.authContext.user_id) return reply.status(409).send({ error: 'An organizer cannot remove themselves' })
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
