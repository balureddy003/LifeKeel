import { afterEach, describe, expect, it } from 'vitest'
import { hasOperatorPermission, resolveOperator } from '../operator-auth.js'

function request(userId = 'user-1', tenantId = 'tenant-1', demo = false) {
  return { authContext: { user_id: userId, tenant_id: tenantId, roles: ['admin'], demo } } as any
}

function dbWithOperator(operator: Record<string, unknown> | null) {
  return {
    collection: () => ({ findOne: async () => operator }),
  } as any
}

afterEach(() => {
  delete process.env['PLATFORM_OPERATOR_USER_IDS']
})

describe('operator authorization', () => {
  it('does not treat a tenant admin as a platform operator', async () => {
    expect(await resolveOperator(dbWithOperator(null), request())).toBeNull()
  })

  it('resolves active database-backed platform roles', async () => {
    const result = await resolveOperator(
      dbWithOperator({ user_id: 'user-1', status: 'active', roles: ['support'] }),
      request(),
    )
    expect(result).toEqual({ user_id: 'user-1', tenant_id: 'tenant-1', roles: ['support'], source: 'database' })
  })

  it('supports an explicit bootstrap user ID as super admin', async () => {
    process.env['PLATFORM_OPERATOR_USER_IDS'] = 'other, user-1'
    const result = await resolveOperator(dbWithOperator(null), request())
    expect(result?.roles).toEqual(['super_admin'])
    expect(result?.source).toBe('bootstrap')
  })

  it('never grants operator access to demo tokens', async () => {
    process.env['PLATFORM_OPERATOR_USER_IDS'] = 'user-1'
    expect(await resolveOperator(dbWithOperator(null), request('user-1', 'tenant-1', true))).toBeNull()
  })

  it('keeps support read-only while platform admins can manage users', () => {
    expect(hasOperatorPermission(['support'], 'users.read')).toBe(true)
    expect(hasOperatorPermission(['support'], 'users.manage')).toBe(false)
    expect(hasOperatorPermission(['platform_admin'], 'users.manage')).toBe(true)
  })
})
