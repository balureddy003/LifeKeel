import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { UTM_MEDIUMS, attributionKey, isValidUtm, newPostTag, utmQuery } from '../utm.js'

describe('utm scheme', () => {
  it('builds the four-part query in a fixed order', () => {
    expect(
      utmQuery({
        source: 'bluesky',
        medium: 'social',
        campaign: 'pillar_chart',
        content: 'chart-1',
      }),
    ).toBe('utm_source=bluesky&utm_medium=social&utm_campaign=pillar_chart&utm_content=chart-1')
    expect(utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'activation' })).toBe(
      'utm_source=lifecycle&utm_medium=email&utm_campaign=activation',
    )
  })
  it('refuses values outside the scheme', () => {
    expect(isValidUtm({ source: 'Bluesky', medium: 'social', campaign: 'x' })).toBe(false) // uppercase
    expect(isValidUtm({ source: 'x', medium: 'cpc' as never, campaign: 'x' })).toBe(false)
    expect(isValidUtm({ source: 'x y', medium: 'social', campaign: 'x' })).toBe(false)
    expect(() => utmQuery({ source: 'x', medium: 'ads' as never, campaign: 'y' })).toThrow(
      /outside the scheme/,
    )
  })
  it('keeps rollup keys bounded: free text, pipes and over-long values count as "other"', () => {
    expect(attributionKey({ utm_source: 'Bluesky ', utm_campaign: 'Pillar_Chart' })).toEqual({
      source: 'bluesky',
      campaign: 'pillar_chart',
    })
    expect(attributionKey({ utm_source: 'a|b', utm_campaign: 'two words' })).toEqual({
      source: 'other',
      campaign: 'other',
    })
    expect(attributionKey({ utm_source: 'x'.repeat(200) })).toEqual({
      source: 'other',
      campaign: 'none',
    })
  })
  it('scripts/utm-link.mjs must not drift from the token rule', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'utm-link.mjs'),
      'utf8',
    )
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'utm.ts'), 'utf8')
    const tokenSrc = (src.match(/const TOKEN = (\/.+?\/)/) ?? [])[1]
    expect(tokenSrc).toBeDefined()
    expect(script).toContain(`const TOKEN = ${tokenSrc}`)
  })

  it('newPostTag always matches the token rule (PRD-218)', () => {
    for (let i = 0; i < 1000; i++) {
      const tag = newPostTag()
      expect(tag).toMatch(/^p[0-9a-f]{8}$/)
      expect(isValidUtm({ source: 'x', medium: 'social', campaign: 'y', content: tag })).toBe(true)
    }
  })

  it('reads missing attribution as direct and none', () => {
    expect(attributionKey(undefined)).toEqual({ source: 'direct', campaign: 'none' })
    expect(attributionKey({ utm_source: 'x', utm_campaign: 'pillar_chart' })).toEqual({
      source: 'x',
      campaign: 'pillar_chart',
    })
  })

  it('every utm_medium written anywhere in the API or web source is one of the allowed mediums', () => {
    const root = path.resolve(__dirname, '..', '..', '..', '..', '..')
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name)
        if (e.isDirectory())
          return ['node_modules', 'dist', '.next', '__tests__'].includes(e.name) ? [] : walk(p)
        return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
      })
    const bad: string[] = []
    for (const f of [
      ...walk(path.join(root, 'apps/api/src')),
      ...walk(path.join(root, 'apps/web/src')),
    ]) {
      const text = fs.readFileSync(f, 'utf8')
      for (const m of text.matchAll(/utm_medium=([a-z_]+)/g)) {
        if (!(UTM_MEDIUMS as readonly string[]).includes(m[1]!))
          bad.push(`${path.relative(root, f)}: ${m[1]}`)
      }
    }
    expect(bad).toEqual([])
  })
})
