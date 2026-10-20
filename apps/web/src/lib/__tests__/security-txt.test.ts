/** PRD-208: security.txt appears only with a real contact, and expires. */
import { describe, expect, it } from 'vitest'
import { buildSecurityTxt } from '../../../scripts/security-txt.mjs'

const NOW = new Date('2026-10-20T00:00:00Z')

describe('buildSecurityTxt', () => {
  it('writes nothing without a contact', () => {
    expect(buildSecurityTxt('', NOW)).toBeNull()
    expect(buildSecurityTxt('   ', NOW)).toBeNull()
    expect(buildSecurityTxt(undefined, NOW)).toBeNull()
  })
  it('turns an address into a mailto contact with a one-year expiry', () => {
    const txt = buildSecurityTxt('security@example.org', NOW, undefined) as string
    expect(txt).toContain('Contact: mailto:security@example.org')
    expect(txt).toContain('Expires: 2027-10-20T00:00:00.000Z')
  })
  it('keeps an https contact as given and adds the canonical URL when set', () => {
    const txt = buildSecurityTxt(
      'https://example.org/report',
      NOW,
      'https://example.org/.well-known/security.txt',
    ) as string
    expect(txt).toContain('Contact: https://example.org/report')
    expect(txt).toContain('Canonical: https://example.org/.well-known/security.txt')
  })
})
