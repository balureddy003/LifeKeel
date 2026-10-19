/**
 * Every custom property the landing stylesheets read must be defined somewhere in them.
 * An undefined token fails silently (the years sky rendered black when --sn1 was missing).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(__dirname, '..')
const FILES = ['landing.css', 'hero.css', 'bands.css']

export function undefinedTokens(css: string): string[] {
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))
  const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!)
  // Set outside these files: by next/font on <html>, or inline by the components.
  const global = new Set([
    '--font-display',
    '--font-body',
    '--font-mono',
    '--font-wordmark',
    '--cardh',
    '--heel',
    '--i',
  ])
  return [...new Set(used)].filter((t) => !defined.has(t) && !global.has(t)).sort()
}

describe('landing css tokens', () => {
  it('reads only tokens that are defined', () => {
    const css = FILES.map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n')
    expect(undefinedTokens(css)).toEqual([])
  })

  it('dark theme redefines every colour token the light theme sets', () => {
    const css = fs.readFileSync(path.join(DIR, 'landing.css'), 'utf8')
    const light = css.slice(css.indexOf('.landing {'), css.indexOf("data-theme='dark'"))
    const dark = css.slice(css.indexOf("data-theme='dark'"))
    const colour = (b: string) => [...b.matchAll(/(--[a-z0-9-]+):\s*(#|rgba)/g)].map((m) => m[1]!)
    const missing = colour(light).filter((t) => !colour(dark).includes(t))
    expect(missing).toEqual([])
  })

  it('the checker catches an undefined token (test would fail without it)', () => {
    expect(
      undefinedTokens('.a { fill: var(--nope); } .b { --yes: red; color: var(--yes); }'),
    ).toEqual(['--nope'])
  })
})
