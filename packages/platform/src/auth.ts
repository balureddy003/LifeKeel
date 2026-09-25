/**
 * JWT Authentication
 *
 * tenant_id is ALWAYS extracted from the JWT claim.
 * Never from URL params. Never from request body.
 * This is the multi-tenant isolation guarantee.
 */

import { SignJWT, jwtVerify } from 'jose'

export interface JwtPayload {
  sub: string          // user_id
  tenant_id: string    // the isolation boundary
  roles: string[]
  demo?: boolean       // true for demo tokens — triggers guard in auth middleware
  iat?: number
  exp?: number
}

export interface AuthContext {
  user_id: string
  tenant_id: string   // use this for ALL database queries
  roles: string[]
  demo?: boolean      // true for demo tokens — triggers guard in auth middleware
  iat?: number        // seconds since epoch — session revocation compares against user.sessions_revoked_at
}

const SENTINEL_VALUES = new Set(['', 'undefined', 'null', 'admin', '__test__'])

export class AuthService {
  private secretBytes: Uint8Array

  constructor(private readonly jwtSecret: string) {
    this.secretBytes = new TextEncoder().encode(jwtSecret)
  }

  async sign(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresIn = '7d'): Promise<string> {
    return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secretBytes)
  }

  async verify(token: string): Promise<AuthContext> {
    const { payload } = await jwtVerify(token, this.secretBytes)
    const tenantId = payload['tenant_id'] as string

    // Hard reject sentinel values — prevents test credentials leaking to prod
    if (!tenantId || SENTINEL_VALUES.has(tenantId)) {
      throw new Error(`Invalid tenant_id in JWT: "${tenantId}"`)
    }

    return {
      user_id: payload.sub ?? '',
      tenant_id: tenantId,
      roles: (payload['roles'] as string[]) ?? [],
      demo: payload['demo'] === true,
      ...(typeof payload.iat === 'number' ? { iat: payload.iat } : {}),
    }
  }
}

/** Extract Bearer token from Authorization header */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7).trim() || null
}
