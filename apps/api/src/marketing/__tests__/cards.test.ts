import { afterEach, describe, expect, it } from 'vitest'
import {
  cardUrl,
  cardSpecHash,
  cardSvg,
  renderCardPng,
  signCard,
  verifyCard,
  wrapText,
  type CardSpec,
} from '../cards.js'

const spec: CardSpec = {
  layout: 'myth_fact',
  headline: 'The papers are all somewhere',
  sub: 'On file',
}

describe('social cards (PRD-219)', () => {
  it('renders a valid PNG at the channel size', async () => {
    const png = await renderCardPng(spec, 'instagram')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    const fb = await renderCardPng(spec, 'facebook')
    expect(fb.length).toBeGreaterThan(100)
  })

  it('signs and verifies — a tampered post id or spec fails', () => {
    const s = signCard('post-1', spec)
    expect(verifyCard('post-1', spec, s)).toBe(true)
    expect(verifyCard('post-2', spec, s)).toBe(false)
    expect(verifyCard('post-1', { ...spec, headline: 'edited' }, s)).toBe(false)
    expect(verifyCard('post-1', spec, 'deadbeef')).toBe(false)
    expect(cardSpecHash(spec)).toHaveLength(16)
  })

  it('wraps long text and throws rather than overflowing', () => {
    const lines = wrapText('word '.repeat(30).trim(), 24, 10)
    expect(lines.every((l) => l.length <= 24)).toBe(true)
    expect(() => wrapText('word '.repeat(500).trim(), 24, 4)).toThrow(/overflow/)
    expect(() => cardSvg({ ...spec, headline: 'long '.repeat(200) }, 'facebook')).toThrow()
  })
})

describe('card URL base', () => {
  const saved = { pub: process.env['API_PUBLIC_URL'], base: process.env['API_BASE_URL'] }
  afterEach(() => {
    for (const [k, v] of [
      ['API_PUBLIC_URL', saved.pub],
      ['API_BASE_URL', saved.base],
    ] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('uses the deployed API_BASE_URL when API_PUBLIC_URL is not set', () => {
    delete process.env['API_PUBLIC_URL']
    process.env['API_BASE_URL'] = 'https://api.example.com/'
    expect(cardUrl('p1', spec)).toMatch(
      /^https:\/\/api\.example\.com\/public\/social-card\/p1\.png\?s=/,
    )
  })

  it('prefers API_PUBLIC_URL when both are set', () => {
    process.env['API_PUBLIC_URL'] = 'https://cdn.example.com'
    process.env['API_BASE_URL'] = 'https://api.example.com'
    expect(cardUrl('p1', spec)).toMatch(/^https:\/\/cdn\.example\.com\//)
  })

  it('gives no URL for a local or plain-http base, since Meta cannot fetch it', () => {
    delete process.env['API_PUBLIC_URL']
    process.env['API_BASE_URL'] = 'http://localhost:3001'
    expect(cardUrl('p1', spec)).toBe('')
    process.env['API_BASE_URL'] = 'http://api.example.com'
    expect(cardUrl('p1', spec)).toBe('')
  })
})
