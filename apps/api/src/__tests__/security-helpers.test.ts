/**
 * Unit tests for the small helpers the security review fixes rely on.
 * Each block names the finding in docs/reviews/SECURITY_AND_COMPLIANCE.md.
 */
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hmacFor,
  rootSigningSecret,
  signState,
  verifyLinkHmac,
  verifyState,
} from '../auth/signing-key.js'
import { sessionsRevokedAt } from '../auth/session-revocation.js'
import { redactUrl, scrubSecrets } from '../observability/redact.js'
import { displayNameError } from '../validation/display-name.js'
import { HEALTH_PLACEHOLDER, withoutHealthDetail } from '../privacy/special-category.js'
import { mayParse, scanRequired } from '../extraction/scan.js'
import { isPrivateAddress } from '@lifekeel/platform'

afterEach(() => vi.unstubAllEnvs())

describe('R41: signing keys', () => {
  it('refuses a missing or short secret outside dev/test', () => {
    vi.stubEnv('NODE_ENV', 'staging')
    vi.stubEnv('JWT_SECRET', 'short')
    expect(() => rootSigningSecret()).toThrow(/JWT_SECRET/)
    vi.stubEnv('JWT_SECRET', '')
    expect(() => rootSigningSecret()).toThrow(/JWT_SECRET/)
  })

  it('derives a different key per purpose, none equal to the root secret', () => {
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40))
    const a = hmacFor('lead-unsubscribe', 'm')
    const b = hmacFor('user-unsubscribe', 'm')
    const root = createHmac('sha256', 'x'.repeat(40)).update('m').digest('base64url')
    expect(a).not.toBe(b)
    expect(a).not.toBe(root)
  })

  it('still accepts unsubscribe links signed before the change', () => {
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40))
    const legacy = createHmac('sha256', 'x'.repeat(40)).update('unsub:l1').digest('base64url')
    expect(verifyLinkHmac('lead-unsubscribe', 'unsub:l1', legacy)).toBe(true)
    expect(verifyLinkHmac('lead-unsubscribe', 'unsub:l2', legacy)).toBe(false)
  })

  it('OAuth state needs an expiry and is bound to its purpose', () => {
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40))
    expect(() =>
      verifyState('connector-oauth-state', signState('connector-oauth-state', { a: 1 })),
    ).toThrow(/expired/)
    const live = signState('connector-oauth-state', { a: 1, exp: Date.now() + 60_000 })
    expect(verifyState('connector-oauth-state', live)['a']).toBe(1)
    expect(() => verifyState('social-oauth-state', live)).toThrow(/signature/)
    expect(() => verifyState('connector-oauth-state', { not: 'a string' })).toThrow()
  })
})

describe('R06: revocation cut-off', () => {
  it('keeping the new session puts the cut-off in the previous second', () => {
    const cut = Math.floor(sessionsRevokedAt(true).getTime() / 1000)
    expect(cut).toBe(Math.floor(Date.now() / 1000) - 1)
  })
})

describe('R22: log redaction', () => {
  it('drops query strings and token-like path segments', () => {
    expect(redactUrl('/connectors/gmail/oauth/callback?code=4/abc&state=xyz')).toBe(
      '/connectors/gmail/oauth/callback?[query removed]',
    )
    expect(redactUrl('/family/invite/3f9a0c1b2d3e4f5a6b7c8d9e0f1a2b3c')).toBe(
      '/family/invite/:redacted',
    )
    expect(redactUrl('/documents/abc/file')).toBe('/documents/abc/file')
  })

  it('scrubs emails, bearer tokens and long tokens from free text', () => {
    const out = scrubSecrets(
      'failed for jane@example.com with Bearer eyJhbGciOi.x.y and key ' + 'a'.repeat(40),
    )
    expect(out).not.toContain('jane@example.com')
    expect(out).not.toContain('eyJhbGciOi')
    expect(out).not.toContain('a'.repeat(40))
  })
})

describe('R43: display names', () => {
  it('accepts ordinary names', () => {
    for (const n of ['The Smiths', "Siobhán O'Neill", 'Familie Novak', '李家'])
      expect(displayNameError(n)).toBeNull()
  })

  it('rejects links, addresses, phone numbers, control characters and long text', () => {
    for (const n of [
      'Your account is suspended — visit bank-secure.com',
      'call 0800 123 4567',
      'mail me at a@b.co',
      'https://evil.example',
      'name\u202eexe',
      'x'.repeat(81),
      '',
    ])
      expect(displayNameError(n), n).not.toBeNull()
  })
})

describe('R13: health terms removed from model context', () => {
  it('keeps the practical facts and drops the health detail', () => {
    const out = withoutHealthDetail(
      "Mum's at County Hospital after a stroke, kids need pickup at 3",
    )
    expect(out).toContain('kids need pickup at 3')
    expect(out).not.toMatch(/hospital|stroke/i)
    expect(out).toContain(HEALTH_PLACEHOLDER)
  })

  it('leaves text with no health terms unchanged', () => {
    expect(withoutHealthDetail('New baby, update the will')).toBe('New baby, update the will')
  })
})

describe('R25: scan-before-parse policy', () => {
  it('requires a scan outside dev/test unless switched off', () => {
    expect(scanRequired({ NODE_ENV: 'production' })).toBe(true)
    expect(scanRequired({ NODE_ENV: 'test' })).toBe(false)
    expect(scanRequired({ NODE_ENV: 'production', MALWARE_SCAN_REQUIRED: 'false' })).toBe(false)
  })

  it('never parses an infected or failed scan, and parses unscanned files only when not required', () => {
    const prod = { NODE_ENV: 'production' }
    expect(mayParse({ result: 'clean', engine: 'clamav' }, prod)).toBe(true)
    expect(mayParse({ result: 'not_performed' }, prod)).toBe(false)
    expect(mayParse({ result: 'not_performed' }, { NODE_ENV: 'test' })).toBe(true)
    expect(mayParse({ result: 'error', engine: 'clamav', reason: 'x' }, { NODE_ENV: 'test' })).toBe(
      false,
    )
  })
})

describe('R07: private address ranges', () => {
  it('blocks loopback, private, link-local, CGNAT, mapped and reserved addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:10.0.0.1',
      '224.0.0.1',
      '198.18.0.1',
    ])
      expect(isPrivateAddress(a), a).toBe(true)
  })

  it('allows public addresses', () => {
    for (const a of ['93.184.216.34', '142.250.80.109', '2607:f8b0:4004:800::200e'])
      expect(isPrivateAddress(a), a).toBe(false)
  })
})
