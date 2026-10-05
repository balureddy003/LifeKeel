/**
 * SCIM 2.0 Service
 *
 * Implements SCIM 2.0 protocol for user and group provisioning.
 * Maps LifeKeel users/groups to SCIM resources for enterprise integration.
 *
 * ADR-0028: SSO and Enterprise Auth - SCIM endpoints
 */

import { createLogger } from '../logger.js'

const log = createLogger({ service: 'scim', version: '0.0.0' })

// ── SCIM 2.0 Types ─────────────────────────────────────────────────────────────

export interface ScimResource {
  schemas: string[]
  id: string
  externalId?: string
  meta: {
    resourceType: string
    location: string
    created: string
    lastModified: string
  }
}

export interface ScimUser extends ScimResource {
  userName: string
  name?: {
    givenName?: string
    familyName?: string
  }
  active?: boolean
  emails?: Array<{
    value: string
    primary?: boolean
    type?: string
  }>
  displayName?: string
  // LifeKeel-specific extensions
  lifekeel?: {
    tenant_id: string
    roles: string[]
    identity_source: string
  }
}

export interface ScimGroup extends ScimResource {
  displayName: string
  members?: Array<{
    value: string
    display?: string
    $ref?: string
  }>
  // LifeKeel-specific extensions
  lifekeel?: {
    tenant_id: string
  }
}

export interface ScimListResponse<T> {
  schemas: string[]
  totalResults: number
  startIndex: number
  itemsPerPage: number
  Resources: T[]
}

export interface ScimError {
  schemas: string[]
  status: string
  detail: string
}

// ── LifeKeel to SCIM Mapper ───────────────────────────────────────────────────────

export class ScimMapper {
  /**
   * Convert LifeKeel user to SCIM user
   */
  lifekeelUserToScim(lifekeelUser: LifeKeelUser, baseUrl: string): ScimUser {
    const result: ScimUser = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: lifekeelUser.id,
      meta: {
        resourceType: 'User',
        location: `${baseUrl}/scim/v2/Users/${lifekeelUser.id}`,
        created: lifekeelUser.created_at.toISOString(),
        lastModified: lifekeelUser.updated_at.toISOString(),
      },
      userName: lifekeelUser.email,
      name: {
        givenName: lifekeelUser.first_name,
        familyName: lifekeelUser.last_name,
      },
      active: lifekeelUser.status === 'active',
      emails: [
        {
          value: lifekeelUser.email,
          primary: true,
          type: 'work',
        },
      ],
      displayName: `${lifekeelUser.first_name} ${lifekeelUser.last_name}`.trim(),
      lifekeel: {
        tenant_id: lifekeelUser.tenant_id,
        roles: lifekeelUser.roles,
        identity_source: lifekeelUser.identity_source,
      },
    }

    if (lifekeelUser.external_id !== undefined) {
      result.externalId = lifekeelUser.external_id
    }

    return result
  }

  /**
   * Convert SCIM user to LifeKeel user
   */
  scimUserToLifeKeel(scimUser: ScimUser, tenantId: string): LifeKeelUser {
    const now = new Date()
    const result: LifeKeelUser = {
      id: scimUser.id,
      tenant_id: tenantId,
      email: scimUser.userName,
      first_name: scimUser.name?.givenName || '',
      last_name: scimUser.name?.familyName || '',
      status: scimUser.active !== false ? 'active' : 'inactive',
      roles: scimUser.lifekeel?.roles || [],
      identity_source: 'scim',
      created_at: scimUser.meta?.created ? new Date(scimUser.meta.created) : now,
      updated_at: scimUser.meta?.lastModified ? new Date(scimUser.meta.lastModified) : now,
    }

    if (scimUser.externalId !== undefined) {
      result.external_id = scimUser.externalId
    }

    return result
  }

  /**
   * Convert LifeKeel group to SCIM group
   */
  lifekeelGroupToScim(lifekeelGroup: LifeKeelGroup, baseUrl: string): ScimGroup {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: lifekeelGroup.id,
      meta: {
        resourceType: 'Group',
        location: `${baseUrl}/scim/v2/Groups/${lifekeelGroup.id}`,
        created: lifekeelGroup.created_at.toISOString(),
        lastModified: lifekeelGroup.updated_at.toISOString(),
      },
      displayName: lifekeelGroup.name,
      members: lifekeelGroup.members.map(member => ({
        value: member.user_id,
        display: member.display_name,
      })),
      lifekeel: {
        tenant_id: lifekeelGroup.tenant_id,
      },
    }
  }

  /**
   * Convert SCIM group to LifeKeel group
   */
  scimGroupToLifeKeel(scimGroup: ScimGroup, tenantId: string): LifeKeelGroup {
    const now = new Date()
    return {
      id: scimGroup.id,
      tenant_id: tenantId,
      name: scimGroup.displayName,
      members: (scimGroup.members || []).map(member => ({
        user_id: member.value,
        display_name: member.display || '',
      })),
      created_at: scimGroup.meta?.created ? new Date(scimGroup.meta.created) : now,
      updated_at: scimGroup.meta?.lastModified ? new Date(scimGroup.meta.lastModified) : now,
    }
  }
}

// ── LifeKeel Types ───────────────────────────────────────────────────────────────

export interface LifeKeelUser {
  id: string
  tenant_id: string
  email: string
  first_name: string
  last_name: string
  status: 'active' | 'inactive'
  roles: string[]
  identity_source: string
  external_id?: string
  created_at: Date
  updated_at: Date
}

export interface LifeKeelGroup {
  id: string
  tenant_id: string
  name: string
  members: Array<{
    user_id: string
    display_name: string
  }>
  created_at: Date
  updated_at: Date
}

// ── SCIM Service ───────────────────────────────────────────────────────────────

export interface ScimServiceOptions {
  baseUrl: string
}

export class ScimService {
  private readonly mapper = new ScimMapper()

  constructor(private readonly options: ScimServiceOptions) {}

  /**
   * Get SCIM user by ID
   */
  async getUser(tenantId: string, userId: string, db: any): Promise<ScimUser | null> {
    const user = await db.collection('users').findOne({
      tenant_id: tenantId,
      id: userId,
    })

    if (!user) return null

    return this.mapper.lifekeelUserToScim(user, this.options.baseUrl)
  }

  /**
   * List SCIM users with pagination and filtering
   */
  async listUsers(
    tenantId: string,
    db: any,
    options: {
      startIndex?: number
      count?: number
      filter?: string
    } = {}
  ): Promise<ScimListResponse<ScimUser>> {
    const startIndex = options.startIndex || 1
    const count = Math.min(options.count || 100, 100) // Max 100 per page

    let query: Record<string, unknown> = { tenant_id: tenantId }

    // Basic filter support (userName eq "user@example.com")
    if (options.filter) {
      const match = options.filter.match(/userName eq "([^"]+)"/)
      if (match) {
        query.email = match[1]
      }
    }

    const users = await db
      .collection('users')
      .find(query)
      .skip(startIndex - 1)
      .limit(count)
      .toArray()

    const totalResults = await db.collection('users').countDocuments(query)

    const resources = users.map((user: LifeKeelUser) =>
      this.mapper.lifekeelUserToScim(user, this.options.baseUrl)
    )

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    }
  }

  /**
   * Create SCIM user
   */
  async createUser(tenantId: string, scimUser: ScimUser, db: any): Promise<ScimUser> {
    const lifekeelUser = this.mapper.scimUserToLifeKeel(scimUser, tenantId)
    lifekeelUser.id = this.generateId()
    lifekeelUser.created_at = new Date()
    lifekeelUser.updated_at = new Date()

    await db.collection('users').insertOne(lifekeelUser)

    log.info({ tenant_id: tenantId, user_id: lifekeelUser.id }, 'SCIM user created')

    return this.mapper.lifekeelUserToScim(lifekeelUser, this.options.baseUrl)
  }

  /**
   * Update SCIM user (PUT - full replace)
   */
  async updateUser(tenantId: string, userId: string, scimUser: ScimUser, db: any): Promise<ScimUser> {
    const existing = await db.collection('users').findOne({
      tenant_id: tenantId,
      id: userId,
    })

    if (!existing) {
      throw new Error('User not found')
    }

    const lifekeelUser = this.mapper.scimUserToLifeKeel(scimUser, tenantId)
    lifekeelUser.id = userId
    lifekeelUser.created_at = existing.created_at
    lifekeelUser.updated_at = new Date()

    await db.collection('users').replaceOne(
      { tenant_id: tenantId, id: userId },
      lifekeelUser
    )

    log.info({ tenant_id: tenantId, user_id: userId }, 'SCIM user updated')

    return this.mapper.lifekeelUserToScim(lifekeelUser, this.options.baseUrl)
  }

  /**
   * Patch SCIM user (PATCH - partial update)
   */
  async patchUser(
    tenantId: string,
    userId: string,
    operations: any[],
    db: any
  ): Promise<ScimUser> {
    const existing = await db.collection('users').findOne({
      tenant_id: tenantId,
      id: userId,
    })

    if (!existing) {
      throw new Error('User not found')
    }

    // Apply patch operations
    const updates: Record<string, unknown> = {}
    for (const op of operations) {
      if (op.op === 'replace' && op.path) {
        const field = op.path.replace('/', '')
        updates[field] = op.value
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date()
      await db.collection('users').updateOne(
        { tenant_id: tenantId, id: userId },
        { $set: updates }
      )
    }

    const updated = await db.collection('users').findOne({
      tenant_id: tenantId,
      id: userId,
    })

    log.info({ tenant_id: tenantId, user_id: userId }, 'SCIM user patched')

    return this.mapper.lifekeelUserToScim(updated, this.options.baseUrl)
  }

  /**
   * Delete SCIM user
   */
  async deleteUser(tenantId: string, userId: string, db: any): Promise<void> {
    const result = await db.collection('users').deleteOne({
      tenant_id: tenantId,
      id: userId,
    })

    if (result.deletedCount === 0) {
      throw new Error('User not found')
    }

    log.info({ tenant_id: tenantId, user_id: userId }, 'SCIM user deleted')
  }

  /**
   * Get SCIM group by ID
   */
  async getGroup(tenantId: string, groupId: string, db: any): Promise<ScimGroup | null> {
    const group = await db.collection('groups').findOne({
      tenant_id: tenantId,
      id: groupId,
    })

    if (!group) return null

    return this.mapper.lifekeelGroupToScim(group, this.options.baseUrl)
  }

  /**
   * List SCIM groups with pagination
   */
  async listGroups(
    tenantId: string,
    db: any,
    options: {
      startIndex?: number
      count?: number
    } = {}
  ): Promise<ScimListResponse<ScimGroup>> {
    const startIndex = options.startIndex || 1
    const count = Math.min(options.count || 100, 100)

    const groups = await db
      .collection('groups')
      .find({ tenant_id: tenantId })
      .skip(startIndex - 1)
      .limit(count)
      .toArray()

    const totalResults = await db.collection('groups').countDocuments({
      tenant_id: tenantId,
    })

    const resources = groups.map((group: LifeKeelGroup) =>
      this.mapper.lifekeelGroupToScim(group, this.options.baseUrl)
    )

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    }
  }

  /**
   * Create SCIM group
   */
  async createGroup(tenantId: string, scimGroup: ScimGroup, db: any): Promise<ScimGroup> {
    const lifekeelGroup = this.mapper.scimGroupToLifeKeel(scimGroup, tenantId)
    lifekeelGroup.id = this.generateId()
    lifekeelGroup.created_at = new Date()
    lifekeelGroup.updated_at = new Date()

    await db.collection('groups').insertOne(lifekeelGroup)

    log.info({ tenant_id: tenantId, group_id: lifekeelGroup.id }, 'SCIM group created')

    return this.mapper.lifekeelGroupToScim(lifekeelGroup, this.options.baseUrl)
  }

  /**
   * Update SCIM group
   */
  async updateGroup(tenantId: string, groupId: string, scimGroup: ScimGroup, db: any): Promise<ScimGroup> {
    const existing = await db.collection('groups').findOne({
      tenant_id: tenantId,
      id: groupId,
    })

    if (!existing) {
      throw new Error('Group not found')
    }

    const lifekeelGroup = this.mapper.scimGroupToLifeKeel(scimGroup, tenantId)
    lifekeelGroup.id = groupId
    lifekeelGroup.created_at = existing.created_at
    lifekeelGroup.updated_at = new Date()

    await db.collection('groups').replaceOne(
      { tenant_id: tenantId, id: groupId },
      lifekeelGroup
    )

    log.info({ tenant_id: tenantId, group_id: groupId }, 'SCIM group updated')

    return this.mapper.lifekeelGroupToScim(lifekeelGroup, this.options.baseUrl)
  }

  /**
   * Delete SCIM group
   */
  async deleteGroup(tenantId: string, groupId: string, db: any): Promise<void> {
    const result = await db.collection('groups').deleteOne({
      tenant_id: tenantId,
      id: groupId,
    })

    if (result.deletedCount === 0) {
      throw new Error('Group not found')
    }

    log.info({ tenant_id: tenantId, group_id: groupId }, 'SCIM group deleted')
  }

  private generateId(): string {
    return `usr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}
