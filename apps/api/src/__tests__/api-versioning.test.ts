import { describe, expect, it } from 'vitest'
import { rewriteVersionedUrl } from '../api-versioning.js'

const req = (url: string) => ({ url }) as Parameters<typeof rewriteVersionedUrl>[0]

describe('rewriteVersionedUrl', () => {
  it('strips the /api prefix Firebase Hosting forwards unchanged', () => {
    expect(rewriteVersionedUrl(req('/api/status'))).toBe('/status')
    expect(rewriteVersionedUrl(req('/api/auth/me'))).toBe('/auth/me')
    expect(rewriteVersionedUrl(req('/api'))).toBe('/')
  })

  it('keeps the existing /v1 alias behaviour', () => {
    expect(rewriteVersionedUrl(req('/v1'))).toBe('/')
    expect(rewriteVersionedUrl(req('/v1/status'))).toBe('/status')
  })

  it('leaves plain paths alone', () => {
    expect(rewriteVersionedUrl(req('/status'))).toBe('/status')
    expect(rewriteVersionedUrl(req('/apiary'))).toBe('/apiary')
    expect(rewriteVersionedUrl(req('/health/ready'))).toBe('/health/ready')
  })
})
