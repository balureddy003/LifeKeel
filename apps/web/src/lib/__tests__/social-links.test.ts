import { describe, expect, it } from 'vitest'
import { socialLinks, whatsappLink } from '../social-links'

describe('socialLinks', () => {
  it('returns nothing when no env var is set', () => {
    expect(socialLinks({})).toEqual([])
  })

  it('accepts https profile URLs on the network domain only', () => {
    const links = socialLinks({
      NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL: 'https://www.instagram.com/lifekeel',
      NEXT_PUBLIC_SOCIAL_FACEBOOK_URL: 'https://evil.example/facebook.com',
      NEXT_PUBLIC_SOCIAL_LINKEDIN_URL: 'http://linkedin.com/company/lifekeel',
    })
    expect(links.map((l) => l.name)).toEqual(['Instagram'])
  })

  it('accepts an x.com or twitter.com profile', () => {
    expect(socialLinks({ NEXT_PUBLIC_SOCIAL_X_URL: 'https://x.com/lifekeel4u' })).toEqual([
      { name: 'X', href: 'https://x.com/lifekeel4u' },
    ])
    expect(socialLinks({ NEXT_PUBLIC_SOCIAL_X_URL: 'https://notx.com/lifekeel4u' })).toEqual([])
  })

  it('rejects javascript: and malformed URLs', () => {
    expect(
      socialLinks({
        NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL: 'javascript:alert(1)',
        NEXT_PUBLIC_SOCIAL_FACEBOOK_URL: 'not a url',
      }),
    ).toEqual([])
  })
})

describe('whatsappLink', () => {
  it('strips punctuation and builds a wa.me link with a prefilled greeting', () => {
    const href = whatsappLink('+44 7700 900123')
    expect(href).toMatch(/^https:\/\/wa\.me\/447700900123\?text=/)
  })

  it('rejects numbers that cannot be a phone number', () => {
    expect(whatsappLink(undefined)).toBeNull()
    expect(whatsappLink('12')).toBeNull()
    expect(whatsappLink('1'.repeat(16))).toBeNull()
  })
})
