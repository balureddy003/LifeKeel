/**
 * The landing and sign-in pages have their own stylesheets (lk-* rules). A staging check at 375px
 * found their buttons and links at 44px, because the 48px fix covered only the app's global rule
 * and Tailwind classes. This scans every stylesheet so a 44px control cannot come back.
 * Decorative icons are not controls, so only min-height, min-width and the pager dots are checked.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = path.join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.css')) out.push(p)
  }
  return out
}

describe('48px tap targets in stylesheets', () => {
  it('no control asks for a 44px minimum', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/min-(height|width):\s*44px/.test(line))
            offenders.push(`${path.relative(SRC, f)}:${i + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it('the sign-in pager dots are 48px', () => {
    const auth = fs.readFileSync(path.join(SRC, 'components/landing/auth.css'), 'utf8')
    expect(auth).toMatch(/\.lk-dot\s*\{[^}]*width:\s*48px;\s*height:\s*48px/)
  })

  it('text links sit on their own line height, so a link inside a sentence is tall enough too', () => {
    const auth = fs.readFileSync(path.join(SRC, 'components/landing/auth.css'), 'utf8')
    const rule = auth.match(/\.lk-textlink\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/min-height:\s*48px/)
    expect(rule).toMatch(/display:\s*inline-flex/)
  })

  it('"Create an account" and "Sign in" in a sentence are actions, so they are 48px too', () => {
    const auth = fs.readFileSync(path.join(SRC, 'components/landing/auth.css'), 'utf8')
    const rule = auth.match(/\.lk-hint \.lk-textlink\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/min-height:\s*48px/)
    expect(rule).not.toMatch(/min-height:\s*0/)
  })
})
