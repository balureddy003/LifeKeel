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
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import { getFamilyGroupsCollection } from '../db.js'
import { isFamilyOrganizer } from '../family/family-permissions.js'
import { cascadeLegacyMemberRemoval } from './family-legacy.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { displayNameError } from '../validation/display-name.js'

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
// Intent 25: a child roster entry's relationship to the adults — kept
// separate from `role` (which gates access) so a blended family can say
// "my child" / "partner's child" / "shared" without inventing roles.
// Optional; display-only — detectors and access checks still read `role`.
export type RelationshipLabel = 'my_child' | 'partners_child' | 'shared_child' | 'other_child'
const VALID_RELATIONSHIP_LABELS: readonly RelationshipLabel[] = [
  'my_child',
  'partners_child',
  'shared_child',
  'other_child',
]

export interface FamilyMemberDoc {
  id: string
  name: string
  email: string
  role: FamilyRole
  status: 'active' | 'pending'
  // The `users.id` this roster entry is bound to once the person accepts a
  // per-member invite (PRD-123). `id` stays the stable roster identity the
  // rest of the product (member twins, attributed insights, profile
  // earners) already keys on; `user_id` is the auth link. For the
  // organizer and members approved through the older join-request flow
  // both fields are the same value — `id` was set to the user's id at
  // creation.
  user_id?: string
  joined_at: string
  // Optional, ISO 'YYYY-MM-DD'. Added so the app can derive age and, for
  // children, years-until-university instead of asking for those as raw
  // numbers that go stale — see docs/prd (financial-profile wizard).
  // Deliberately not required at creation: captured later via PATCH, at
  // the point it's actually needed (progressive disclosure).
  date_of_birth?: string
  // Intent 25: optional relationship label for children ("my child" /
  // "partner's child" / "shared"). Set via POST/PATCH; display-only.
  relationship_label?: RelationshipLabel
}

export interface FamilyGroupDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  name: string
  invite_code: string
  members: FamilyMemberDoc[]
  // PRD-130: the continuity switch ("dead man's switch" in the vision).
  // Organizer-set: after check_in_after_days of organizer inactivity the
  // job emails the organizer a check-in; after a further grace_days of
  // silence it notifies the designated members so the family's emergency
  // plan doesn't depend on one person's availability. Purely
  // informational — it never grants access or releases anything (the
  // vault's standing-adult-access model means there is nothing to
  // "unlock"); it exists to surface readiness to the right people.
  continuity?: {
    enabled: boolean
    designated_member_ids: string[]
    check_in_after_days: number
    grace_days: number
  }
  /**
   * Gap-8 context slice: a short organizer-authored free-text note about
   * the household ("we're a blended family; Maya finishes uni in 2027")
   * that Ask Keel reads as context. User-authored and deletable — same
   * sensitivity class as the financial profile, and the UI asks for no
   * medical details (health stays GDPR-deferred).
   */
  context_note?: string
  created_at: Date
  updated_at: Date
}

interface UserDoc extends Record<string, unknown> {
  id: string
  name?: string
  email?: string
}

function toResponse(doc: FamilyGroupDoc, inviteViewedAt: Map<string, Date> = new Map()) {
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
      // Intent 63: a pending member's invite status — 'sent' until the
      // accept page resolves the token, then 'viewed'.
      ...(m.status === 'pending'
        ? {
            inviteStatus: inviteViewedAt.has(m.id) ? 'viewed' : 'sent',
            ...(inviteViewedAt.has(m.id)
              ? { inviteViewedAt: inviteViewedAt.get(m.id)!.toISOString() }
              : {}),
          }
        : {}),
      ...(m.user_id ? { userId: m.user_id } : {}),
      ...(m.date_of_birth ? { dateOfBirth: m.date_of_birth } : {}),
      ...(m.relationship_label ? { relationshipLabel: m.relationship_label } : {}),
    })),
    ...(doc.context_note ? { contextNote: doc.context_note } : {}),
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

  const groupsFor = (tenantId: string) =>
    getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId)

  // ── GET /family ──────────────────────────────────────────────────────────
  fastify.get('/family', async (req) => {
    const { tenant_id } = req.authContext
    const doc = await groupsFor(tenant_id).findOne({})
    // Invite views for pending members — one query, then looked up per
    // member in toResponse (intent 63).
    const viewed = await getTenantCollection<Record<string, unknown>>(
      db,
      'family_member_invites',
      doc?.tenant_id ?? req.authContext.tenant_id,
    )
      .find({ viewed_at: { $exists: true } })
      .toArray()
      .catch(() => [] as Record<string, unknown>[])
    const inviteViewedAt = new Map<string, Date>(
      viewed
        .filter((i: Record<string, unknown>) => i['member_id'] && i['viewed_at'])
        .map((i: Record<string, unknown>) => [i['member_id'] as string, i['viewed_at'] as Date]),
    )
    return { family: doc ? toResponse(doc, inviteViewedAt) : null }
  })

  // ── POST /family ─────────────────────────────────────────────────────────
  fastify.post<{ Body: { name: string } }>('/family', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const nameError = displayNameError(req.body?.name, 'Family name')
    if (nameError) return reply.status(400).send({ error: nameError })
    const name = (req.body?.name as string).trim()

    const groups = groupsFor(tenant_id)
    const existing = await groups.findOne({})
    if (existing) return reply.status(409).send({ error: 'Family already exists for this account' })

    const owner = await getTenantCollection<UserDoc>(db, 'users', tenant_id).findOne({
      id: user_id,
    })

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
    const nameError = displayNameError(req.body?.name, 'Family name')
    if (nameError) return reply.status(400).send({ error: nameError })
    const name = (req.body?.name as string).trim()

    if (!(await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)))
      return reply.status(403).send({ error: 'Only the organizer can manage the family' })
    const result = (await groupsFor(tenant_id).findOneAndUpdate(
      {},
      { $set: { name, updated_at: new Date() } },
      { returnDocument: 'after' },
    )) as FamilyGroupDoc | null
    if (!result) return reply.status(404).send({ error: 'Family not found' })
    return { family: toResponse(result) }
  })

  // ── POST /family/members ────────────────────────────────────────────────
  fastify.post<{
    Body: {
      name: string
      email: string
      role: FamilyRole
      date_of_birth?: string
      relationship_label?: RelationshipLabel
    }
  }>('/family/members', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { name, email, role, date_of_birth, relationship_label } = req.body ?? {}
    if (!name?.trim() || !role)
      return reply.status(400).send({ error: 'Member name and role required' })
    const memberNameError = displayNameError(name, 'Member name')
    if (memberNameError) return reply.status(400).send({ error: memberNameError })
    if (!VALID_ROLES.includes(role)) {
      return reply
        .status(400)
        .send({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` })
    }
    if (date_of_birth && !isValidDateOfBirth(date_of_birth)) {
      return reply
        .status(400)
        .send({ error: "Invalid date of birth. Use 'YYYY-MM-DD', not in the future." })
    }
    if (relationship_label !== undefined) {
      if (!VALID_RELATIONSHIP_LABELS.includes(relationship_label))
        return reply.status(400).send({ error: 'Invalid relationship_label' })
      if (role !== 'child')
        return reply.status(400).send({ error: 'relationship_label only applies to child members' })
    }

    if (!(await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)))
      return reply.status(403).send({ error: 'Only the organizer can manage the family' })
    const member: FamilyMemberDoc = {
      id: randomUUID(),
      name: name.trim(),
      email: email?.trim() ?? '',
      role,
      status: 'pending',
      joined_at: new Date().toISOString(),
      ...(date_of_birth ? { date_of_birth } : {}),
      ...(relationship_label ? { relationship_label } : {}),
    }

    const result = (await groupsFor(tenant_id).findOneAndUpdate(
      {},
      { $push: { members: member }, $set: { updated_at: new Date() } },
      { returnDocument: 'after' },
    )) as FamilyGroupDoc | null
    if (!result) return reply.status(404).send({ error: 'Family not found — create one first' })
    return reply.status(201).send({ family: toResponse(result) })
  })

  // ── PATCH /family/members/:id ───────────────────────────────────────────
  // Accepts role and/or date_of_birth — the only two mutable fields on a
  // roster member today (name/email are set once, at invite time). At
  // least one must be present.
  fastify.patch<{
    Params: { id: string }
    Body: {
      role?: FamilyRole
      date_of_birth?: string
      relationship_label?: RelationshipLabel | null
    }
  }>('/family/members/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { role, date_of_birth, relationship_label } = req.body ?? {}
    if (role === undefined && date_of_birth === undefined && relationship_label === undefined) {
      return reply.status(400).send({ error: 'role, date_of_birth or relationship_label required' })
    }
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return reply
        .status(400)
        .send({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` })
    }
    if (relationship_label !== undefined && relationship_label !== null) {
      if (!VALID_RELATIONSHIP_LABELS.includes(relationship_label))
        return reply.status(400).send({ error: 'Invalid relationship_label' })
    }
    if (date_of_birth !== undefined && !isValidDateOfBirth(date_of_birth)) {
      return reply
        .status(400)
        .send({ error: "Invalid date of birth. Use 'YYYY-MM-DD', not in the future." })
    }

    if (!(await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)))
      return reply.status(403).send({ error: 'Only the organizer can manage the family' })
    if (req.params.id === req.authContext.user_id && role !== undefined && role !== 'organizer')
      return reply.status(409).send({ error: 'An organizer cannot remove their own role' })

    // Labels only make sense on children — check against the effective
    // role (a single PATCH may set role and label together).
    if (relationship_label !== undefined && relationship_label !== null) {
      const group = (await groupsFor(tenant_id).findOne({
        'members.id': req.params.id,
      })) as FamilyGroupDoc | null
      const member = group?.members.find((m) => m.id === req.params.id)
      if (!member) return reply.status(404).send({ error: 'Member not found' })
      if ((role ?? member.role) !== 'child')
        return reply.status(400).send({ error: 'relationship_label only applies to child members' })
    }

    const set: Record<string, unknown> = { updated_at: new Date() }
    const unset: Record<string, unknown> = {}
    if (role !== undefined) set['members.$.role'] = role
    if (date_of_birth !== undefined) set['members.$.date_of_birth'] = date_of_birth
    if (relationship_label !== undefined && relationship_label !== null)
      set['members.$.relationship_label'] = relationship_label
    if (relationship_label === null) unset['members.$.relationship_label'] = ''
    // A label set when the member was a child must not survive a role
    // change to adult/parent — the child-only guard above only covers
    // the same request.
    if (role !== undefined && role !== 'child') unset['members.$.relationship_label'] = ''

    const result = (await groupsFor(tenant_id).findOneAndUpdate(
      { 'members.id': req.params.id },
      Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
      { returnDocument: 'after' },
    )) as FamilyGroupDoc | null
    if (!result) return reply.status(404).send({ error: 'Member not found' })
    return { family: toResponse(result) }
  })

  // ── DELETE /family/members/:id ──────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/family/members/:id', async (req, reply) => {
    const { tenant_id } = req.authContext

    if (!(await isFamilyOrganizer(db, tenant_id, req.authContext.user_id)))
      return reply.status(403).send({ error: 'Only the organizer can manage the family' })
    if (req.params.id === req.authContext.user_id)
      return reply.status(409).send({ error: 'An organizer cannot remove themselves' })
    const before = (await groupsFor(tenant_id).findOneAndUpdate(
      {},
      { $pull: { members: { id: req.params.id } }, $set: { updated_at: new Date() } },
      { returnDocument: 'before' },
    )) as FamilyGroupDoc | null
    if (!before) return reply.status(404).send({ error: 'Family not found' })
    const removed = before.members.find((m) => m.id === req.params.id)
    const result: FamilyGroupDoc = {
      ...before,
      members: before.members.filter((m) => m.id !== req.params.id),
    }

    // Removal ends access (R03): the linked login is marked removed (the
    // auth hook and login both refuse it), every session it holds is
    // revoked, and any outstanding invite for the entry dies with it.
    if (removed) {
      const userIds = [...new Set([removed.id, removed.user_id].filter((v): v is string => !!v))]
      await db
        .collection('users')
        .updateMany(
          { tenant_id, id: { $in: userIds }, roles: { $nin: ['owner'] } },
          { $set: { status: 'removed', sessions_revoked_at: new Date(), updated_at: new Date() } },
        )
      await db.collection('family_member_invites').deleteMany({ tenant_id, member_id: removed.id })
      getAuditLogger()?.fromRequest(req, 'family.member_removed', 'family_member', removed.id, {
        had_login: Boolean(removed.user_id) || removed.status === 'active',
      })
    }

    // PRD-137: roles the removed member held on legacy documents flip to
    // 'unverified' rather than disappearing silently — the register keeps
    // the record honest about who it used to name. Best-effort; deletion
    // already committed.
    await cascadeLegacyMemberRemoval(db, tenant_id, req.params.id)

    log.info({ tenant_id, memberId: req.params.id }, 'Family member removed')
    return { family: toResponse(result) }
  })

  // ── PATCH /family/context ────────────────────────────────────────────
  // Gap-8 context slice: a short organizer-authored note Ask Keel reads as
  // household context. User-authored, organizer-gated, deletable (empty
  // string clears). Not a channel for medical data — the UI says so and
  // health stays deferred by design.
  fastify.patch<{ Body: { note?: string } }>('/family/context', async (req, reply) => {
    const { tenant_id } = req.authContext
    if (!(await isFamilyOrganizer(db, tenant_id, req.authContext.user_id))) {
      return reply.status(403).send({ error: 'Only the organizer can set the family context' })
    }
    const note = (req.body?.note ?? '').trim().slice(0, 500)
    const result = (await groupsFor(tenant_id).findOneAndUpdate(
      {},
      note
        ? { $set: { context_note: note, updated_at: new Date() } }
        : { $unset: { context_note: '' }, $set: { updated_at: new Date() } },
      { returnDocument: 'after' },
    )) as FamilyGroupDoc | null
    if (!result) return reply.status(404).send({ error: 'Family not found' })
    return { family: toResponse(result) }
  })
}
