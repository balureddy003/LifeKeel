import { describe, expect, it } from 'vitest'
import {
  GA4_SCOPE,
  GoogleReadError,
  SEARCH_CONSOLE_SCOPE,
  googleErrorFrom,
  isoDay,
  readbackConfig,
  readbackPresence,
  sanitizeQuery,
} from '../google-read.js'

describe('scopes', () => {
  it('only ever asks Google for read-only scopes', () => {
    expect(SEARCH_CONSOLE_SCOPE).toMatch(/readonly$/)
    expect(GA4_SCOPE).toMatch(/readonly$/)
  })
})

describe('configuration reports booleans only', () => {
  it('treats blanks as unset and strips the properties/ prefix', () => {
    const cfg = readbackConfig({
      GOOGLE_READONLY_SERVICE_ACCOUNT_JSON: '  ',
      SEARCH_CONSOLE_SITE_URL: '',
      GA4_PROPERTY_ID: 'properties/12345',
    } as never)
    expect(cfg.credentialsJson).toBeUndefined()
    expect(cfg.propertyId).toBe('12345')
    expect(readbackPresence(cfg)).toEqual({ credentials: false, search_console: false, ga4: false })
  })

  it('needs a key plus the property to count as configured, and the presence object has no values', () => {
    const cfg = readbackConfig({
      GOOGLE_READONLY_SERVICE_ACCOUNT_JSON: '{"client_email":"a","private_key":"SECRET"}',
      SEARCH_CONSOLE_SITE_URL: 'sc-domain:lifekeel.co.uk',
      GA4_PROPERTY_ID: 'abc',
    } as never)
    const p = readbackPresence(cfg)
    expect(p).toEqual({ credentials: true, search_console: true, ga4: false }) // property id must be numeric
    expect(JSON.stringify(p)).not.toContain('SECRET')
  })
})

describe('sanitizeQuery', () => {
  it('keeps a plain query, lower-cased and tidied', () => {
    expect(sanitizeQuery('  What To Do   When Someone Dies ')).toBe('what to do when someone dies')
  })
  it('drops anything that could identify a person', () => {
    expect(sanitizeQuery('jane.doe@example.com will')).toBeNull()
    expect(sanitizeQuery('call 07700 900123')).toBeNull()
    expect(sanitizeQuery('policy 123456789')).toBeNull()
    expect(sanitizeQuery('   ')).toBeNull()
  })
  it('cuts to 200 characters', () => {
    expect(sanitizeQuery('a'.repeat(500))!.length).toBe(200)
  })
})

describe('error mapping', () => {
  const res = (status: number, message?: string) =>
    new Response(JSON.stringify(message ? { error: { message } } : {}), { status })
  it('maps statuses to kinds and uses only Google’s message', async () => {
    expect((await googleErrorFrom(res(403, 'User does not have access'), 'GA4 report')).kind).toBe(
      'forbidden',
    )
    expect((await googleErrorFrom(res(401), 'x')).kind).toBe('forbidden')
    expect((await googleErrorFrom(res(429), 'x')).kind).toBe('quota')
    expect((await googleErrorFrom(res(404), 'x')).kind).toBe('not_found')
    const e = await googleErrorFrom(res(500, 'boom'), 'Search Console query')
    expect(e).toBeInstanceOf(GoogleReadError)
    expect(e.kind).toBe('failed')
    expect(e.message).toBe('Search Console query failed: HTTP 500 — boom')
  })
})

describe('isoDay', () => {
  it('counts back in UTC days', () => {
    expect(isoDay(new Date('2026-10-24T12:00:00Z'), 3)).toBe('2026-10-21')
  })
})
