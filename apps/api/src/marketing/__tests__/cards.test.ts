import { describe, expect, it } from 'vitest'
import {
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
