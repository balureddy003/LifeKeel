/**
 * The site denies the microphone everywhere. Voice needs it on one page, so a
 * rule allows `microphone=(self)` for the domains pages only, and only for this
 * page's own origin (never a third-party frame). Changing this file is a
 * security-setting change: this test makes the scope explicit.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Rule = { source: string; headers: Array<{ key: string; value: string }> }
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'firebase.json'), 'utf8'),
)
const family: { target: string; headers: Rule[] } = config.hosting.find(
  (h: { target: string }) => h.target === 'family',
)

const policy = (r: Rule) => r.headers.find((h) => h.key === 'Permissions-Policy')?.value

describe('microphone permission', () => {
  it('stays denied for every page by default', () => {
    const all = family.headers.find((r) => r.source === '**')!
    expect(policy(all)).toContain('microphone=()')
    expect(policy(all)).toContain('camera=()')
  })

  it('is allowed for the page itself, and only on the domains pages', () => {
    const allowing = family.headers.filter((r) => policy(r)?.includes('microphone=(self)'))
    expect(allowing.map((r) => r.source).sort()).toEqual(['/domains', '/domains/**'])
    for (const r of allowing) {
      expect(policy(r)).toContain('camera=()')
      expect(policy(r)).not.toMatch(/microphone=\(\*\)|microphone=\([^)]*https?:/)
    }
  })

  it('comes after the site-wide rule, so the narrower rule is the one applied', () => {
    const order = family.headers.map((r) => r.source)
    const all = order.indexOf('**')
    for (const s of ['/domains', '/domains/**']) expect(order.indexOf(s)).toBeGreaterThan(all)
  })

  it('does not open the microphone on any other hosting target', () => {
    for (const h of config.hosting.filter((x: { target: string }) => x.target !== 'family'))
      for (const r of (h.headers ?? []) as Rule[])
        expect(policy(r) ?? '').not.toContain('microphone=(self)')
  })
})
