/**
 * One noun for what a household has recorded: "the family list" (owner decision,
 * 2026-11-07). "On file" is retired in the domain pages, packs and home doors,
 * and the roster is "the family" (so the word list never means two things).
 * A tripwire for the obvious regressions, like advice-rule.test.ts.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const FILES = [
  'apps/api/src/domains/packs/life-protection.ts',
  'apps/api/src/domains/packs/car.ts',
  'apps/api/src/domains/playbook.ts',
  'apps/api/src/domains/view.ts',
  'apps/api/src/domains/records.ts',
  'apps/api/src/domains/types.ts',
  'apps/api/src/routes/family-domains.ts',
  'apps/web/src/app/domains/page.tsx',
  'apps/web/src/app/domains/domain-copy.ts',
  'apps/web/src/app/domains/layout.tsx',
  'apps/web/src/components/ThreeDoors.tsx',
].filter((f) => fs.existsSync(path.join(ROOT, f)))

/** Copy lines only: comments may explain the rule. */
const code = (f: string) =>
  fs
    .readFileSync(path.join(ROOT, f), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

describe('one noun for the household record', () => {
  it('scans the files that exist', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(8)
  })

  for (const f of FILES) {
    it(`${f} does not say "on file"`, () => {
      expect(code(f)).not.toMatch(/\bon file\b/i)
    })
  }

  it('never calls the roster "the family list"', () => {
    for (const f of FILES)
      expect(code(f), f).not.toMatch(
        /(no longer|not) (on|in) the family list|person on the family list|adults on the family list/i,
      )
  })
})
