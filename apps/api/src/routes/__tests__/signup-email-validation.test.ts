/**
 * Live-verification finding: POST /auth/signup only ever checked
 * `email.includes('@')` — a malformed address like
 * "a@ea@example.comxample.com" (two '@' signs, from a real fat-fingered
 * signup during manual testing) passed straight through and came back
 * `email_verified: true`, permanently unreachable. Now checks a real
 * (if pragmatic) email format — local part, one '@', a domain with a dot.
 *
 * Requests intentionally omit `password` so the handler 400s before ever
 * reaching getDb() (same trick signup-rate-limit.test.ts uses) — this
 * exercises the email check itself without needing a real MongoDB.
 */

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { AuthService } from '@agentoak/platform'
import { registerAuthUserRoutes } from '../auth-users.js'

async function signupAttempt(email: string) {
  const app = Fastify()
  await registerAuthUserRoutes(app, new AuthService('test-secret'))
  return app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, name: 'Test User', workspace: `workspace-${Math.random().toString(36).slice(2)}` },
  })
}

describe('POST /auth/signup rejects malformed email addresses', () => {
  it.each([
    'a@ea@example.comxample.com', // the exact shape found during manual testing
    'not-an-email',
    'missing-domain@',
    '@missing-local.com',
    'no-dot-in-domain@example',
    'has spaces@example.com',
  ])('rejects %s with 400 "Valid email required"', async (email) => {
    const res = await signupAttempt(email)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Valid email required')
  })

  it('accepts a well-formed email and proceeds past the email check (400s on password next)', async () => {
    const res = await signupAttempt('real.person@example.com')
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Password must be at least 8 characters')
  })
})
