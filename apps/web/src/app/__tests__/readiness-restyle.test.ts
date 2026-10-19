import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const page = fs.readFileSync(path.resolve(__dirname, '..', 'readiness', 'page.tsx'), 'utf8')
const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'components', 'landing', 'public.css'), 'utf8')

describe('readiness quiz in the landing look', () => {
  it('result bands describe gaps, not a verdict on the person', () => {
    for (const label of ['Well covered', 'Some gaps', 'Several gaps', 'Many gaps']) expect(page).toContain(`label: '${label}'`)
    expect(page).not.toContain("'At risk'")
    expect(page).not.toContain('scored and monitored')
  })

  it('the result card makes no always-on or monitoring claims and points at signup', () => {
    for (const bad of ['keeps watching', 'monitors them continuously', 'even when nobody logs in', 'Start monitoring', 'checked\n']) {
      expect(page).not.toContain(bad)
    }
    expect(page).not.toMatch(/checked\s+daily/)
    expect(page).toContain("appUrl('/signup')")
    expect(page).toContain('Create your free account')
  })

  it('the progress track override is scoped to the track, not every tinted panel', () => {
    expect(css).toMatch(/\.lk-public \.h-1\\\.5\.bg-tint\\\/5/)
    expect(css).not.toMatch(/\.lk-public \.bg-tint\\\/5 \{/)
  })

  it('hints sit below their field with space before the next label', () => {
    expect(page).not.toContain('-mt-2 mb-4 px-1')
    expect(page).toContain('-mt-3 mb-6 px-1')
  })

  it('the landing margin reset does not cancel the spacing utilities on public pages', () => {
    const hero = fs.readFileSync(path.resolve(__dirname, '..', '..', 'components', 'landing', 'hero.css'), 'utf8')
    expect(hero).toContain('.landing:not(.lk-public) p')
    expect(hero).not.toMatch(/^\.landing p,/m)
  })

  it('fields and the progress track use the landing tokens', () => {
    expect(css).toMatch(/\.lk-public \.glass-input\s*\{[^}]*var\(--field-line\)/)
    expect(css).toMatch(/\.lk-public \.bg-gradient-to-r\s*\{[^}]*var\(--brass\)/)
  })
})
