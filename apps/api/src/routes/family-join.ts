/**
 * Family Join Routes — PRD-110: a second real login for an existing
 * family, gated on explicit organizer approval.
 *
 * POST /family/join                              — public: submit a join request against a family's invite code
 * GET  /family/access-requests                    — organizer-only: list pending requests for their family
 * POST /family/access-requests/:id/approve        — organizer-only: create the real login, add them to the roster
 * POST /family/access-requests/:id/deny           — organizer-only: discard the request, nothing was ever created
 * POST /family/invite-code/reset                  — organizer-only: invalidate the old code for new join attempts
 *
 * Security posture (see PRD-110's "Trust tier"): POST /family/join never
 * creates a `users` row and never grants any access by itself, no matter
 * what code was entered — only an explicit organizer approval does. This
 * mirrors the Act layer's own "prepare, don't auto-execute" discipline,
 * applied to account access instead of financial/legal/medical actions.
 *
 * Route naming note: deliberately NOT `/family/join-requests` — the auth
 * hook's open-route allowlist in server.ts matches by `startsWith`, and
 * `/family/join-requests` starts with `/family/join`, which would have
 * made the organizer-only list/approve/deny endpoints public too.
 * `/family/access-requests` shares no prefix with `/family/join`.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomBytes, randomUUID } from 'node:crypto'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import { getFamilyGroupsCollection, getFamilyJoinRequestsCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { hashPassword, getUsersCollection, AVATAR_COLORS, EMAIL_FORMAT_RE, type User } from './auth-users.js'
import { generateInviteCode, type FamilyGroupDoc, type FamilyMemberDoc } from './family-group.js'

const log = createLogger({ service: 'family-join', version: '0.0.0' })

interface FamilyJoinRequestDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  name: string
  email: string
  password_hash: string
  salt: string
  status: 'pending'
  requested_at: Date
}

interface JoinBody {
  invite_code?: string
  name?: string
  email?: string
  password?: string
}

export function registerFamilyJoinRoutes(fastify: FastifyInstance, db: Db): void {
  const requests = getFamilyJoinRequestsCollection(db)
  requests.createIndex({ tenant_id: 1, status: 1 }).catch(() => {})

  const groupsFor = (tenantId: string) => getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId)

  // Resolves whether the authenticated caller is the organizer of their
  // own family — the same check the PRD's acceptance criteria requires,
  // and one that didn't exist anywhere yet: every other /family/members
  // write today only checks tenant_id, not role, because there was never
  // a second real login in that tenant to distinguish from the organizer.
  const requireOrganizer = async (tenantId: string, userId: string): Promise<FamilyGroupDoc | null> => {
    const family = await groupsFor(tenantId).findOne({})
    if (!family) return null
    const caller = family.members.find((m) => m.id === userId)
    if (caller?.role !== 'organizer') return null
    return family
  }

  // ── POST /family/join ───────────────────────────────────────────────────
  fastify.post<{ Body: JoinBody }>(
    '/family/join',
    // Rate-limited like signup — an invite code is a shared, guessable-ish
    // secret (6 hex characters), so brute-forcing it needs the same
    // per-route throttle signup already applies to email enumeration.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { invite_code, name, email, password } = req.body ?? {}
      if (!invite_code?.trim()) return reply.status(400).send({ error: 'Invite code required' })
      if (!name?.trim()) return reply.status(400).send({ error: 'Name required' })
      if (!email || !EMAIL_FORMAT_RE.test(email.trim())) return reply.status(400).send({ error: 'Valid email required' })
      if (!password || password.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' })

      const normalizedEmail = email.trim().toLowerCase()

      // Raw, unscoped lookup — the whole point is the requester has no
      // tenant context yet. invite_code is globally unique (family-group.ts's
      // own index), so this resolves to at most one family.
      const rawGroups = getFamilyGroupsCollection(db)
      const family = (await rawGroups.findOne({ invite_code: invite_code.trim().toUpperCase() })) as FamilyGroupDoc | null
      if (!family) return reply.status(400).send({ error: 'Invalid invite code' })

      const users = await getUsersCollection()
      const existingUser = await users.findOne({ email: normalizedEmail })
      if (existingUser) return reply.status(409).send({ error: 'Email already registered' })

      const existingRequest = await requests.findOne({ tenant_id: family.tenant_id, email: normalizedEmail, status: 'pending' })
      if (existingRequest) return reply.status(409).send({ error: 'A request for this email is already pending' })

      const salt = randomBytes(16).toString('hex')
      const doc: FamilyJoinRequestDoc = {
        id: randomUUID(),
        tenant_id: family.tenant_id,
        name: name.trim(),
        email: normalizedEmail,
        password_hash: hashPassword(password, salt),
        salt,
        status: 'pending',
        requested_at: new Date(),
      }
      await requests.insertOne(doc)
      // Not `.fromRequest()` — there's no authContext yet (this route is
      // public), and that helper would fall back to tenant_id 'unknown'
      // even though the real tenant_id is right here from the invite-code
      // lookup above.
      getAuditLogger()?.log({
        tenant_id: family.tenant_id,
        user_id: 'anonymous',
        action: 'family.join_requested',
        resource_type: 'family_join_request',
        resource_id: doc.id,
        metadata: { email: normalizedEmail },
        ip: req.ip,
        user_agent: req.headers['user-agent'] ?? '',
        timestamp: new Date(),
      })

      log.info({ tenantId: family.tenant_id, requestId: doc.id }, 'Family join request submitted')
      return reply.status(201).send({ status: 'pending', family_name: family.name })
    },
  )

  // ── GET /family/access-requests ─────────────────────────────────────────
  fastify.get('/family/access-requests', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const family = await requireOrganizer(tenant_id, user_id)
    if (!family) return reply.status(403).send({ error: 'Only the organizer can view join requests' })

    const pending = await requests.find({ tenant_id, status: 'pending' }).sort({ requested_at: -1 }).toArray()
    return {
      requests: pending.map((r) => ({ id: r['id'], name: r['name'], email: r['email'], requestedAt: (r['requested_at'] as Date).toISOString() })),
    }
  })

  // ── POST /family/access-requests/:id/approve ────────────────────────────
  fastify.post<{ Params: { id: string } }>('/family/access-requests/:id/approve', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const family = await requireOrganizer(tenant_id, user_id)
    if (!family) return reply.status(403).send({ error: 'Only the organizer can approve join requests' })

    const request = (await requests.findOne({ id: req.params.id, tenant_id, status: 'pending' })) as FamilyJoinRequestDoc | null
    if (!request) return reply.status(404).send({ error: 'Join request not found' })

    const users = await getUsersCollection()
    // Re-check at approval time, not just at request time — someone else
    // could have registered this email in the interim.
    const emailTaken = await users.findOne({ email: request.email })
    if (emailTaken) {
      await requests.deleteOne({ id: request.id })
      return reply.status(409).send({ error: 'This email was registered elsewhere since the request was made' })
    }

    const newUser: User = {
      id: randomUUID(),
      email: request.email,
      name: request.name,
      tenant_id,
      password_hash: request.password_hash,
      salt: request.salt,
      created_at: new Date(),
      avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
      roles: ['viewer'],
      status: 'active',
      failed_login_attempts: undefined,
      locked_until: undefined,
      external_id: undefined,
      external_provider: undefined,
      email_verified: undefined,
      email_verification_token: undefined,
      email_verification_expires: undefined,
      password_reset_token: undefined,
      password_reset_expires: undefined,
      updated_at: undefined,
    }
    await users.insertOne(newUser)

    // Deliberately 'adult' — PRD-110 scopes this feature to adults only;
    // there is no path here that could ever land someone at 'child' or
    // 'organizer'. Mirrors the organizer's own entry shape exactly
    // (`id` = the real `users.id`), which is what lets requireOrganizer's
    // single role check work uniformly for both.
    const newMember: FamilyMemberDoc = {
      id: newUser.id,
      name: request.name,
      email: request.email,
      role: 'adult',
      status: 'active',
      joined_at: new Date().toISOString(),
    }
    await groupsFor(tenant_id).updateOne({}, { $push: { members: newMember }, $set: { updated_at: new Date() } })
    await requests.deleteOne({ id: request.id })

    getAuditLogger()?.fromRequest(req, 'family.join_approved', 'family_join_request', request.id, { new_user_id: newUser.id, email: request.email })
    log.info({ tenantId: tenant_id, newUserId: newUser.id }, 'Family join request approved')

    return { approved: true, name: newUser.name, email: newUser.email }
  })

  // ── POST /family/access-requests/:id/deny ───────────────────────────────
  fastify.post<{ Params: { id: string } }>('/family/access-requests/:id/deny', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const family = await requireOrganizer(tenant_id, user_id)
    if (!family) return reply.status(403).send({ error: 'Only the organizer can deny join requests' })

    const result = await requests.deleteOne({ id: req.params.id, tenant_id, status: 'pending' })
    if (result.deletedCount === 0) return reply.status(404).send({ error: 'Join request not found' })

    getAuditLogger()?.fromRequest(req, 'family.join_denied', 'family_join_request', req.params.id, {})
    return { denied: true }
  })

  // ── POST /family/invite-code/reset ──────────────────────────────────────
  fastify.post('/family/invite-code/reset', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const family = await requireOrganizer(tenant_id, user_id)
    if (!family) return reply.status(403).send({ error: 'Only the organizer can reset the invite code' })

    // invite_code is globally unique across all families (family-group.ts's
    // own index) — retry on the astronomically rare collision rather than
    // fail the whole request over it.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode()
      try {
        await groupsFor(tenant_id).updateOne({}, { $set: { invite_code: code, updated_at: new Date() } })
        getAuditLogger()?.fromRequest(req, 'family.invite_code_reset', 'family_group', family.id, {})
        return { inviteCode: code }
      } catch {
        continue
      }
    }
    return reply.status(500).send({ error: 'Could not generate a new invite code — please try again' })
  })
}
