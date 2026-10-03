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
 * PRD-123 (per-member invite — the reverse direction):
 * POST /family/members/:id/invite                 — organizer-only: email a specific pending roster member an invite
 * GET  /family/invite/:token                      — public: resolve a token to member+family names for the accept page
 * POST /family/invite/accept                      — public: verify token, create/link the login, activate the roster entry
 *
 * Open-route allowlist note: `/family/invite/…` shares no prefix with the
 * organizer-only `/family/invite-code/reset` — `startsWith('/family/invite/')`
 * (with the trailing slash) matches the token routes and NOT `invite-code`.
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
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import { getFamilyGroupsCollection, getFamilyJoinRequestsCollection, getFamilyMemberInvitesCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { hashPassword, getUsersCollection, AVATAR_COLORS, EMAIL_FORMAT_RE, type User } from './auth-users.js'
import { sendFamilyInviteEmail } from '../auth-email.js'
import { memberMatchesUser } from '../lib/family-permissions.js'
import { generateInviteCode, type FamilyGroupDoc, type FamilyMemberDoc } from './family-group.js'
import type { AuthService } from '@agentoak/platform'

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

// A per-member invite (PRD-123) is bearer-token access to a specific pending
// roster entry — whoever presents the token claims that member's identity.
// It therefore expires, is deleted on use, and is never written to logs or
// audit metadata.
interface FamilyMemberInviteDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  member_id: string
  email: string
  token: string
  expires_at: Date
  created_at: Date
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface JoinBody {
  invite_code?: string
  name?: string
  email?: string
  password?: string
}

export function registerFamilyJoinRoutes(fastify: FastifyInstance, db: Db, auth?: AuthService): void {
  const requests = getFamilyJoinRequestsCollection(db)
  requests.createIndex({ tenant_id: 1, status: 1 }).catch(() => {})
  const invites = getFamilyMemberInvitesCollection(db)
  invites.createIndex({ token: 1 }, { unique: true }).catch(() => {})
  invites.createIndex({ tenant_id: 1, member_id: 1 }).catch(() => {})

  const groupsFor = (tenantId: string) => getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId)

  // Resolves whether the authenticated caller is the organizer of their
  // own family — the same check the PRD's acceptance criteria requires,
  // and one that didn't exist anywhere yet: every other /family/members
  // write today only checks tenant_id, not role, because there was never
  // a second real login in that tenant to distinguish from the organizer.
  const requireOrganizer = async (tenantId: string, userId: string): Promise<FamilyGroupDoc | null> => {
    const family = await groupsFor(tenantId).findOne({})
    if (!family) return null
    const caller = family.members.find((m) => memberMatchesUser(m, userId))
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
      // The invite link itself proves mailbox ownership — it only reached
      // this address because the organizer's invite email landed there.
      email_verified: true,
      email_verification_token: undefined,
      email_verification_expires: undefined,
      password_reset_token: undefined,
      password_reset_expires: undefined,
      updated_at: undefined,
    }
    await users.insertOne(newUser)

    // PRD-123: if the organizer already had this person on the roster as a
    // pending member (matched by the request's email), activate THAT entry
    // rather than appending a second row for the same human — `id` stays
    // the stable identity member twins/insights already reference and the
    // new user is linked via `user_id`.
    const pendingMatch = family.members.find((m) => m.email === request.email && m.status === 'pending')
    if (pendingMatch) {
      await groupsFor(tenant_id).updateOne(
        { 'members.id': pendingMatch.id },
        {
          $set: {
            'members.$.status': 'active',
            'members.$.user_id': newUser.id,
            'members.$.joined_at': new Date().toISOString(),
            updated_at: new Date(),
          },
        },
      )
    } else {
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
    }
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

  // ── POST /family/members/:id/invite (PRD-123) ───────────────────────────
  // Organizer emails a pending roster member a one-time invite link. This is
  // the reverse of /family/join: instead of a stranger presenting a shared
  // code and the organizer approving, the organizer names the person and the
  // person accepts — and acceptance activates the *existing* roster entry,
  // not a duplicate.
  fastify.post<{ Params: { id: string }; Body: { email?: string } }>(
    '/family/members/:id/invite',
    // Organizer-initiated so it doesn't need the tight brute-force limit
    // /family/join gets, but bounded anyway — each send is a real outbound
    // email that could be used to spam an address.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const family = await requireOrganizer(tenant_id, user_id)
      if (!family) return reply.status(403).send({ error: 'Only the organizer can invite members' })

      const member = family.members.find((m) => m.id === req.params.id)
      if (!member) return reply.status(404).send({ error: 'Member not found' })
      // A child's twin is managed by the adults — minors don't get their
      // own credential-bearing login through this flow at all. Checked
      // before status so a pending child reads as "can't have a sign-in"
      // rather than "already active".
      if (member.role === 'child') return reply.status(400).send({ error: 'Child members cannot have their own sign-in' })
      if (member.status !== 'pending') return reply.status(409).send({ error: 'This member is already active' })

      // Email comes from the roster entry when the organizer set it at
      // member-add time; otherwise it's supplied here and persisted so the
      // roster entry carries it forward.
      const email = (req.body?.email?.trim() || member.email || '').toLowerCase()
      if (!email || !EMAIL_FORMAT_RE.test(email)) return reply.status(400).send({ error: 'A valid email is required to send an invite' })

      const users = await getUsersCollection()
      const existingUser = await users.findOne({ email })
      if (existingUser && existingUser.tenant_id !== tenant_id) {
        return reply.status(409).send({ error: 'This email is registered to a different account' })
      }

      // One outstanding invite per member — re-inviting rotates the token
      // rather than leaving multiple live claims on the same roster entry.
      await invites.deleteMany({ tenant_id, member_id: member.id })
      const token = randomBytes(24).toString('hex')
      const invite: FamilyMemberInviteDoc = {
        id: randomUUID(),
        tenant_id,
        member_id: member.id,
        email,
        token,
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
        created_at: new Date(),
      }
      await invites.insertOne(invite)

      if (!member.email) {
        await groupsFor(tenant_id).updateOne(
          { 'members.id': member.id },
          { $set: { 'members.$.email': email, updated_at: new Date() } },
        )
      }

      const appUrl = (process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
      const inviteUrl = `${appUrl}/invite/${token}`
      await sendFamilyInviteEmail(email, member.name, family.name, inviteUrl)

      // Token deliberately absent from audit metadata — it's a live credential.
      getAuditLogger()?.fromRequest(req, 'family.member_invited', 'family_member', member.id, { email })
      log.info({ tenantId: tenant_id, memberId: member.id }, 'Family member invite created')

      // invite_url is returned so the organizer can share it manually when
      // SendGrid isn't configured (the email silently no-ops in that case).
      return reply.status(201).send({ invited: true, emailed: Boolean(process.env['SENDGRID_API_KEY']), invite_url: inviteUrl })
    },
  )

  // ── GET /family/invite/:token (PRD-123, public) ─────────────────────────
  // Lets the accept page render "X invited you to join Y" before the
  // recipient commits a password. Reveals only names — never whether the
  // email is registered, never any financial detail.
  fastify.get<{ Params: { token: string } }>(
    '/family/invite/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const invite = (await invites.findOne({ token: req.params.token })) as FamilyMemberInviteDoc | null
      if (!invite || invite.expires_at.getTime() < Date.now()) {
        return reply.status(404).send({ error: 'This invite link is invalid or has expired' })
      }
      const family = (await getFamilyGroupsCollection(db).findOne({ tenant_id: invite.tenant_id })) as FamilyGroupDoc | null
      const member = family?.members.find((m) => m.id === invite.member_id)
      if (!family || !member || member.status !== 'pending') {
        return reply.status(404).send({ error: 'This invite link is invalid or has expired' })
      }
      return { member_name: member.name, family_name: family.name, expires_at: invite.expires_at.toISOString() }
    },
  )

  // ── POST /family/invite/accept (PRD-123, public) ────────────────────────
  // The recipient's one claim on the roster entry: verifies the token, then
  // either creates a login or verifies the password against an existing
  // same-tenant account, and flips the roster entry pending → active with
  // user_id bound. Unlike /family/join this grants access immediately —
  // the trust gate already ran when the organizer issued the invite.
  fastify.post<{ Body: { token?: string; password?: string } }>(
    '/family/invite/accept',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token, password } = req.body ?? {}
      if (!token?.trim()) return reply.status(400).send({ error: 'Invite token required' })
      if (!password || password.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' })

      const invite = (await invites.findOne({ token: token.trim() })) as FamilyMemberInviteDoc | null
      if (!invite || invite.expires_at.getTime() < Date.now()) {
        return reply.status(400).send({ error: 'This invite link is invalid or has expired' })
      }
      const family = (await getFamilyGroupsCollection(db).findOne({ tenant_id: invite.tenant_id })) as FamilyGroupDoc | null
      const member = family?.members.find((m) => m.id === invite.member_id)
      // Already-activated or removed entries reject — a token can't
      // resurrect access after the roster changed.
      if (!family || !member || member.status !== 'pending' || member.user_id) {
        return reply.status(400).send({ error: 'This invite link is invalid or has expired' })
      }

      const users = await getUsersCollection()
      const existingUser = await users.findOne({ email: invite.email })
      let userId: string
      if (existingUser) {
        if (existingUser.tenant_id !== invite.tenant_id) {
          return reply.status(409).send({ error: 'This email is registered to a different account' })
        }
        // Existing same-tenant account (e.g. previously approved through
        // the join-request flow): the password has to verify against it —
        // the token claims the roster entry, the password proves the
        // account. Wrong password → no link, invite survives for retry.
        const actual = Buffer.from(hashPassword(password, existingUser.salt ?? ''), 'hex')
        const expected = Buffer.from(String(existingUser.password_hash ?? ''), 'hex')
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          return reply.status(401).send({ error: 'Incorrect password for the existing account' })
        }
        userId = existingUser.id as string
      } else {
        const salt = randomBytes(16).toString('hex')
        const newUser: User = {
          id: randomUUID(),
          email: invite.email,
          name: member.name,
          tenant_id: invite.tenant_id,
          password_hash: hashPassword(password, salt),
          salt,
          created_at: new Date(),
          avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
          roles: ['viewer'],
          status: 'active',
          failed_login_attempts: undefined,
          locked_until: undefined,
          external_id: undefined,
          external_provider: undefined,
          // Invite-accepted account — the emailed token link is the
          // mailbox-ownership proof, same as the join-request path above.
          email_verified: true,
          email_verification_token: undefined,
          email_verification_expires: undefined,
          password_reset_token: undefined,
          password_reset_expires: undefined,
          updated_at: undefined,
        }
        await users.insertOne(newUser)
        userId = newUser.id
      }

      // Activate the EXISTING roster entry in place — `id` stays the stable
      // identity member twins and attributed insights already reference;
      // user_id is the new auth link.
      await groupsFor(invite.tenant_id).updateOne(
        { 'members.id': member.id },
        {
          $set: {
            'members.$.status': 'active',
            'members.$.user_id': userId,
            'members.$.email': invite.email,
            'members.$.joined_at': new Date().toISOString(),
            updated_at: new Date(),
          },
        },
      )
      await invites.deleteOne({ id: invite.id })

      getAuditLogger()?.log({
        tenant_id: invite.tenant_id,
        user_id: userId,
        action: 'family.member_invite_accepted',
        resource_type: 'family_member',
        resource_id: member.id,
        metadata: {},
        ip: req.ip,
        user_agent: req.headers['user-agent'] ?? '',
        timestamp: new Date(),
      })
      log.info({ tenantId: invite.tenant_id, memberId: member.id, userId }, 'Family member invite accepted')

      // Sign them straight in — mirrors signup/login's return shape.
      const sessionToken = auth
        ? await auth.sign({ sub: userId, tenant_id: invite.tenant_id, roles: ['viewer'] })
        : undefined
      return {
        accepted: true,
        token: sessionToken,
        // Accepting via the emailed link proved mailbox ownership — the
        // client carries it forward instead of prompting to re-verify.
        user: { id: userId, email: invite.email, name: member.name, email_verified: true },
      }
    },
  )
}
