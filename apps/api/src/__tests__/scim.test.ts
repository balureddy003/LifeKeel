/**
 * SCIM 2.0 Service Tests
 *
 * Tests for SCIM user and group provisioning functionality.
 *
 * ADR-0028: SSO and Enterprise Auth - SCIM endpoints
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoClient, Db } from 'mongodb'
import { ScimService, type ScimUser, type ScimGroup } from '@kairos/platform'

describe('SCIM Service', () => {
  let mongoClient: MongoClient
  let db: Db
  let scimService: ScimService

  const TENANT_ID = 'scim-test-tenant'
  const BASE_URL = 'http://localhost:3001/scim/v2'

  beforeEach(async () => {
    mongoClient = new MongoClient(process.env.MONGODB_URL ?? 'mongodb://localhost:27017')
    await mongoClient.connect()
    db = mongoClient.db('kairos-scim-test')

    scimService = new ScimService({ baseUrl: BASE_URL })

    // Clean up test data
    await db.collection('users').deleteMany({})
    await db.collection('groups').deleteMany({})
  })

  afterEach(async () => {
    await db.collection('users').deleteMany({})
    await db.collection('groups').deleteMany({})
    await mongoClient.close()
  })

  describe('User Operations', () => {
    it('should create a SCIM user', async () => {
      const scimUser: Partial<ScimUser> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'test@example.com',
        name: {
          givenName: 'Test',
          familyName: 'User',
        },
        active: true,
        emails: [
          {
            value: 'test@example.com',
            primary: true,
            type: 'work',
          },
        ],
        displayName: 'Test User',
      }

      const created = await scimService.createUser(TENANT_ID, scimUser, db)

      expect(created).toBeDefined()
      expect(created.userName).toBe('test@example.com')
      expect(created.name?.givenName).toBe('Test')
      expect(created.name?.familyName).toBe('User')
      expect(created.active).toBe(true)
      expect(created.id).toBeDefined()
    })

    it('should get a SCIM user by ID', async () => {
      // First create a user
      const scimUser: Partial<ScimUser> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'get-test@example.com',
        name: {
          givenName: 'Get',
          familyName: 'Test',
        },
        active: true,
      }

      const created = await scimService.createUser(TENANT_ID, scimUser, db)

      // Then get the user
      const retrieved = await scimService.getUser(TENANT_ID, created.id, db)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.userName).toBe('get-test@example.com')
    })

    it('should list SCIM users with pagination', async () => {
      // Create multiple users
      for (let i = 0; i < 5; i++) {
        const user: Partial<ScimUser> = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `user${i}@example.com`,
          name: {
            givenName: `User${i}`,
            familyName: 'Test',
          },
          active: true,
        }
        await scimService.createUser(TENANT_ID, user, db)
      }

      // List users
      const result = await scimService.listUsers(TENANT_ID, db, {
        startIndex: 1,
        count: 10,
      })

      expect(result.totalResults).toBe(5)
      expect(result.Resources).toHaveLength(5)
      expect(result.startIndex).toBe(1)
    })

    it('should update a SCIM user (PUT)', async () => {
      const user: Partial<ScimUser> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'update-test@example.com',
        name: {
          givenName: 'Update',
          familyName: 'Test',
        },
        active: true,
      }
      const created = await scimService.createUser(TENANT_ID, user, db)

      const updatedUser = {
        ...created,
        name: {
          givenName: 'Updated',
          familyName: 'Name',
        },
        active: false,
      }

      const updated = await scimService.updateUser(TENANT_ID, created.id, updatedUser, db)

      expect(updated.name?.givenName).toBe('Updated')
      expect(updated.name?.familyName).toBe('Name')
      expect(updated.active).toBe(false)
    })

    it('should delete a SCIM user', async () => {
      const user: Partial<ScimUser> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'delete-test@example.com',
        name: {
          givenName: 'Delete',
          familyName: 'Test',
        },
        active: true,
      }
      const created = await scimService.createUser(TENANT_ID, user, db)

      await scimService.deleteUser(TENANT_ID, created.id, db)

      const retrieved = await scimService.getUser(TENANT_ID, created.id, db)
      expect(retrieved).toBeNull()
    })

    it('should return null for non-existent user', async () => {
      const retrieved = await scimService.getUser(TENANT_ID, 'non-existent-id', db)
      expect(retrieved).toBeNull()
    })
  })

  describe('Group Operations', () => {
    it('should create a SCIM group', async () => {
      const scimGroup: Partial<ScimGroup> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Test Group',
        members: [
          {
            value: 'user-1',
            display: 'User One',
          },
        ],
      }

      const created = await scimService.createGroup(TENANT_ID, scimGroup, db)

      expect(created).toBeDefined()
      expect(created.displayName).toBe('Test Group')
      expect(created.members).toHaveLength(1)
      expect(created.id).toBeDefined()
    })

    it('should get a SCIM group by ID', async () => {
      const group: Partial<ScimGroup> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Get Test Group',
        members: [],
      }
      const created = await scimService.createGroup(TENANT_ID, group, db)

      const retrieved = await scimService.getGroup(TENANT_ID, created.id, db)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.displayName).toBe('Get Test Group')
    })

    it('should list SCIM groups', async () => {
      // Create multiple groups
      for (let i = 0; i < 3; i++) {
        const group: Partial<ScimGroup> = {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: `Group ${i}`,
          members: [],
        }
        await scimService.createGroup(TENANT_ID, group, db)
      }

      const result = await scimService.listGroups(TENANT_ID, db, {
        startIndex: 1,
        count: 10,
      })

      expect(result.totalResults).toBe(3)
      expect(result.Resources).toHaveLength(3)
    })

    it('should update a SCIM group', async () => {
      const group: Partial<ScimGroup> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Original Group',
        members: [],
      }
      const created = await scimService.createGroup(TENANT_ID, group, db)

      const updatedGroup = {
        ...created,
        displayName: 'Updated Group',
        members: [
          {
            value: 'user-1',
            display: 'User One',
          },
        ],
      }

      const updated = await scimService.updateGroup(TENANT_ID, created.id, updatedGroup, db)

      expect(updated.displayName).toBe('Updated Group')
      expect(updated.members).toHaveLength(1)
    })

    it('should delete a SCIM group', async () => {
      const group: Partial<ScimGroup> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Delete Test Group',
        members: [],
      }
      const created = await scimService.createGroup(TENANT_ID, group, db)

      await scimService.deleteGroup(TENANT_ID, created.id, db)

      const retrieved = await scimService.getGroup(TENANT_ID, created.id, db)
      expect(retrieved).toBeNull()
    })
  })

  describe('Cross-Tenant Isolation', () => {
    it('should not leak users between tenants', async () => {
      const tenantA = 'tenant-a'
      const tenantB = 'tenant-b'

      // Create user for tenant A
      const userA: Partial<ScimUser> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'user-a@example.com',
        name: { givenName: 'User', familyName: 'A' },
        active: true,
      }
      await scimService.createUser(tenantA, userA, db)

      // Create user for tenant B
      const userB: Partial<ScimUser> = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'user-b@example.com',
        name: { givenName: 'User', familyName: 'B' },
        active: true,
      }
      await scimService.createUser(tenantB, userB, db)

      // List users for tenant A
      const usersA = await scimService.listUsers(tenantA, db)
      expect(usersA.totalResults).toBe(1)
      expect(usersA.Resources[0]?.userName).toBe('user-a@example.com')

      // List users for tenant B
      const usersB = await scimService.listUsers(tenantB, db)
      expect(usersB.totalResults).toBe(1)
      expect(usersB.Resources[0]?.userName).toBe('user-b@example.com')
    })
  })
})
