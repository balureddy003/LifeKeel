/**
 * The signed-in app follows the LifeKeel palette because its colour utilities read CSS variables.
 * These checks keep the variables defined in both themes and keep stray purple out of the source.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..', '..')
const css = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8')
const tw = fs.readFileSync(path.join(SRC, '..', 'tailwind.config.js'), 'utf8')

const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('\n}\n', css.indexOf(sel)))

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p)
    return /\.(ts|tsx|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}

function rgb(triplet: string): [number, number, number] {
  return triplet.trim().split(/\s+/).map(Number) as [number, number, number]
}
function lum([r, g, b]: [number, number, number]) {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function ratio(a: string, b: string) {
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
const token = (b: string, name: string) => new RegExp(`--${name}:\\s*([\\d ]+);`).exec(b)![1]!

describe('app theme', () => {
  const dark = block(':root {')
  const light = block("[data-theme='light'] {")

  it('both themes define the brass call to action and its label colour', () => {
    for (const [name, b] of [['dark', dark], ['light', light]] as const) {
      for (const v of ['family-500', 'family-600', 'family-700', 'on-cta', 'family-400', 'ink-1', 'surface-0']) {
        expect(b, `${name} ${v}`).toMatch(new RegExp(`--${v}:`))
      }
    }
  })

  it('the call-to-action label and the brass text keep AA contrast in both themes', () => {
    for (const b of [dark, light]) {
      expect(ratio(token(b, 'on-cta'), token(b, 'family-500'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(b, 'ink-1'), token(b, 'surface-0'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(b, 'ink-3'), token(b, 'surface-0'))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(token(b, 'family-400'), token(b, 'surface-0'))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('tailwind reads the family fill from the variable, not a purple literal', () => {
    expect(tw).toContain("500: 'rgb(var(--family-500) / <alpha-value>)'")
    expect(tw).not.toMatch(/#7061ef|#6b5ce0|#5a4dd0/i)
  })

  it('no old purple hex remains in the app source', () => {
    const banned = /#7061ef|#7c6ef0|#6b5ce0|#8b80f8|#6d5ef5|#a78bfa|#6c5ce7/i
    const hits = walk(SRC)
      .filter((f) => !f.endsWith(path.join('landing', 'landing.css')))
      .flatMap((f) =>
        fs
          .readFileSync(f, 'utf8')
          .split('\n')
          .map((l, i) => ({ f: path.relative(SRC, f), i: i + 1, l }))
          .filter(({ l }) => banned.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)),
      )
      .map(({ f, i }) => `${f}:${i}`)
    expect(hits).toEqual([])
  })

  it('the desktop rail follows the theme instead of a fixed dark colour', () => {
    const rail = fs.readFileSync(path.join(SRC, 'components', 'NavRail.tsx'), 'utf8')
    expect(rail).toContain('rgb(var(--nav-bg)')
    expect(rail).not.toContain('rgba(8, 8, 12')
  })

  it('dark labels cover gradient and translucent brass fills, and h1 sizing leaves responsive sizes alone', () => {
    expect(css).toContain(".from-family-500.text-white")
    expect(css).toContain("[class*='bg-family-500/'].text-white")
    expect(css).toMatch(/h1\.text-2xl:not\(\[class\*=':text-'\]\)/)
  })

  it('the JS accent twin keeps 3:1 on the light surface', () => {
    const hex = /FAMILY_ACCENT = '(#[0-9a-f]{6})'/i.exec(
      fs.readFileSync(path.join(SRC, 'lib', 'familySections.ts'), 'utf8'),
    )![1]!
    const t = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')
    expect(ratio(t, token(light, 'surface-0'))).toBeGreaterThanOrEqual(3)
    expect(ratio(t, token(dark, 'surface-0'))).toBeGreaterThanOrEqual(3)
  })
})
