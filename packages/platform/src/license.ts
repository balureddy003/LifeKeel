import { importSPKI, jwtVerify } from 'jose'

export interface LicensePayload {
  tenant_id: string
  edition: string
  plan: string
  valid_until: string
  features: string[]
  expired: boolean
  grace_period: boolean
}

export async function validateLicenseKey(token: string, publicKeyPem: string, now = new Date()): Promise<LicensePayload> {
  const key = await importSPKI(publicKeyPem, 'RS256')
  const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'] })
  const validUntil = new Date(String(payload['valid_until']))
  if (Number.isNaN(validUntil.getTime())) throw new Error('License valid_until is invalid')
  const expired = now > validUntil
  const gracePeriod = expired && now.getTime() <= validUntil.getTime() + 14 * 86_400_000
  return {
    tenant_id: String(payload['tenant_id']),
    edition: String(payload['edition']),
    plan: String(payload['plan']),
    valid_until: validUntil.toISOString(),
    features: Array.isArray(payload['features']) ? payload['features'].map(String) : [],
    expired,
    grace_period: gracePeriod,
  }
}
