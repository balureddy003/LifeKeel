/**
 * LifeKeel never uses the microphone itself. Speaking instead of typing is done
 * by the phone's own keyboard dictation, which does not need this site to hold
 * the permission. So every page on every hosting target denies it, and this test
 * fails if a rule opens it again (a security-setting change, to be made on purpose).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Rule = { source: string; headers: Array<{ key: string; value: string }> }
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'firebase.json'), 'utf8'),
)

const policy = (r: Rule) => r.headers.find((h) => h.key === 'Permissions-Policy')?.value

describe('microphone permission', () => {
  it('is denied on every page of every hosting target', () => {
    for (const h of config.hosting as Array<{ target: string; headers?: Rule[] }>)
      for (const r of h.headers ?? []) {
        const value = policy(r)
        if (value === undefined) continue
        expect(value, `${h.target} ${r.source}`).toContain('microphone=()')
        expect(value, `${h.target} ${r.source}`).not.toContain('microphone=(self')
        expect(value, `${h.target} ${r.source}`).toContain('camera=()')
      }
  })

  it('keeps the site-wide rule that denies it', () => {
    for (const h of config.hosting as Array<{ target: string; headers?: Rule[] }>) {
      const all = (h.headers ?? []).find((r) => r.source === '**')
      expect(policy(all!), h.target).toContain('microphone=()')
    }
  })
})
