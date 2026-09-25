import { describe, expect, it } from 'vitest'
import { AuthService } from '../auth.js'

describe('AuthService', () => {
  const auth = new AuthService('test-secret-that-is-long-enough-for-hs256')

  it('returns iat so the middleware can enforce session revocation', async () => {
    const token = await auth.sign({ sub: 'user-1', tenant_id: 'family-1', roles: ['admin'] })
    const ctx = await auth.verify(token)
    expect(ctx.user_id).toBe('user-1')
    expect(ctx.iat).toBeTypeOf('number')
    expect(ctx.iat!).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  })
})
