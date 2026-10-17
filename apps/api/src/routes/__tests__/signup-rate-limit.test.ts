/**
 * KEEL-025: POST /auth/signup's distinguishable 409 on an existing email is
 * a genuine UX need (kept as-is), so the mitigation is a tighter
 * route-level rate limit that raises the cost of a bulk email-enumeration
 * sweep. Registers the real @fastify/rate-limit plugin and the real route,
 * then hammers it past its declared ceiling — proves the config is wired
 * to something real, not just present in the source.
 *
 * Requests intentionally omit `password` so the handler 400s before ever
 * reaching getDb() — the rate limiter runs ahead of the handler regardless,
 * so this exercises the limit without needing a real MongoDB.
 */

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { AuthService } from '@lifekeel/platform'
import { registerAuthUserRoutes } from '../auth-users.js'

describe('KEEL-025: POST /auth/signup has a dedicated rate limit', () => {
  it('returns 429 on the 11th signup attempt within a minute (max 10/min)', async () => {
    const app = Fastify()
    await app.register(rateLimit, { global: false })
    await registerAuthUserRoutes(app, new AuthService('test-secret'))

    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { email: `user${i}@example.com`, name: 'Test User', workspace: `workspace-${i}` },
      })
      statuses.push(res.statusCode)
    }

    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
