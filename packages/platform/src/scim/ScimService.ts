/**
 * SCIM 2.0 Service
 *
 * Implements SCIM 2.0 protocol for user and group provisioning.
 * Maps Kairos users/groups to SCIM resources for enterprise integration.
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
  // Kairos-specific extensions
  kairos?: {
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
  // Kairos-specific extensions
  kairos?: {
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

// ── Kairos to SCIM Mapper ───────────────────────────────────────────────────────

export class ScimMapper {
  /**
   * Convert Kairos user to SCIM user
   */
  kairosUserToScim(kairosUser: KairosUser, baseUrl: string): ScimUser {
    const result: ScimUser = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: kairosUser.id,
      meta: {
        resourceType: 'User',
        location: `${baseUrl}/scim/v2/Users/${kairosUser.id}`,
        created: kairosUser.created_at.toISOString(),
        lastModified: kairosUser.updated_at.toISOString(),
      },
      userName: kairosUser.email,
      name: {
        givenName: kairosUser.first_name,
        familyName: kairosUser.last_name,
      },
      active: kairosUser.status === 'active',
      emails: [
        {
          value: kairosUser.email,
          primary: true,
          type: 'work',
        },
      ],
      displayName: `${kairosUser.first_name} ${kairosUser.last_name}`.trim(),
      kairos: {
        tenant_id: kairosUser.tenant_id,
        roles: kairosUser.roles,
        identity_source: kairosUser.identity_source,
      },
    }

    if (kairosUser.external_id !== undefined) {
      result.externalId = kairosUser.external_id
    }

    return result
  }

  /**
   * Convert SCIM user to Kairos user
   */
  scimUserToKairos(scimUser: ScimUser, tenantId: string): KairosUser {
    const now = new Date()
    const result: KairosUser = {
      id: scimUser.id,
      tenant_id: tenantId,
      email: scimUser.userName,
      first_name: scimUser.name?.givenName || '',
      last_name: scimUser.name?.familyName || '',
      status: scimUser.active !== false ? 'active' : 'inactive',
      roles: scimUser.kairos?.roles || [],
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
   * Convert Kairos group to SCIM group
   */
  kairosGroupToScim(kairosGroup: KairosGroup, baseUrl: string): ScimGroup {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: kairosGroup.id,
      meta: {
        resourceType: 'Group',
        location: `${baseUrl}/scim/v2/Groups/${kairosGroup.id}`,
        created: kairosGroup.created_at.toISOString(),
        lastModified: kairosGroup.updated_at.toISOString(),
      },
      displayName: kairosGroup.name,
      members: kairosGroup.members.map(member => ({
        value: member.user_id,
        display: member.display_name,
      })),
      kairos: {
        tenant_id: kairosGroup.tenant_id,
      },
    }
  }

  /**
   * Convert SCIM group to Kairos group
   */
  scimGroupToKairos(scimGroup: ScimGroup, tenantId: string): KairosGroup {
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

// ── Kairos Types ───────────────────────────────────────────────────────────────

export interface KairosUser {
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

export interface KairosGroup {
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

    return this.mapper.kairosUserToScim(user, this.options.baseUrl)
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

    const resources = users.map((user: KairosUser) =>
      this.mapper.kairosUserToScim(user, this.options.baseUrl)
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
    const kairosUser = this.mapper.scimUserToKairos(scimUser, tenantId)
    kairosUser.id = this.generateId()
    kairosUser.created_at = new Date()
    kairosUser.updated_at = new Date()

    await db.collection('users').insertOne(kairosUser)

    log.info({ tenant_id: tenantId, user_id: kairosUser.id }, 'SCIM user created')

    return this.mapper.kairosUserToScim(kairosUser, this.options.baseUrl)
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

    const kairosUser = this.mapper.scimUserToKairos(scimUser, tenantId)
    kairosUser.id = userId
    kairosUser.created_at = existing.created_at
    kairosUser.updated_at = new Date()

    await db.collection('users').replaceOne(
      { tenant_id: tenantId, id: userId },
      kairosUser
    )

    log.info({ tenant_id: tenantId, user_id: userId }, 'SCIM user updated')

    return this.mapper.kairosUserToScim(kairosUser, this.options.baseUrl)
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

    return this.mapper.kairosUserToScim(updated, this.options.baseUrl)
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

    return this.mapper.kairosGroupToScim(group, this.options.baseUrl)
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

    const resources = groups.map((group: KairosGroup) =>
      this.mapper.kairosGroupToScim(group, this.options.baseUrl)
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
    const kairosGroup = this.mapper.scimGroupToKairos(scimGroup, tenantId)
    kairosGroup.id = this.generateId()
    kairosGroup.created_at = new Date()
    kairosGroup.updated_at = new Date()

    await db.collection('groups').insertOne(kairosGroup)

    log.info({ tenant_id: tenantId, group_id: kairosGroup.id }, 'SCIM group created')

    return this.mapper.kairosGroupToScim(kairosGroup, this.options.baseUrl)
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

    const kairosGroup = this.mapper.scimGroupToKairos(scimGroup, tenantId)
    kairosGroup.id = groupId
    kairosGroup.created_at = existing.created_at
    kairosGroup.updated_at = new Date()

    await db.collection('groups').replaceOne(
      { tenant_id: tenantId, id: groupId },
      kairosGroup
    )

    log.info({ tenant_id: tenantId, group_id: groupId }, 'SCIM group updated')

    return this.mapper.kairosGroupToScim(kairosGroup, this.options.baseUrl)
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
