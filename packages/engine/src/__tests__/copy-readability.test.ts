/**
 * Plain language is part of ease of use. This scores the sentences families read
 * in the domain pages, packs, home doors and notification catalogue, and fails
 * when one gets hard to read or leans on jargon. It is a tripwire for drift, not
 * a substitute for testing with real people (docs/research/usability-test-kit).
 *
 * Score: Flesch-Kincaid grade level per sentence (a rough US-school-grade
 * measure; 8 is roughly age 13 to 14). Sentences under 6 words are not scored.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { MAX_GRADE, copyIn, grade, sentencesIn, syllables } from './readability-lib.js'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const FILES = [
  'apps/api/src/domains/packs/life-protection.ts',
  'apps/api/src/domains/packs/car.ts',
  'apps/api/src/domains/playbook.ts',
  'apps/api/src/domains/view.ts',
  'apps/web/src/app/domains/domain-copy.ts',
  'apps/web/src/components/ThreeDoors.tsx',
  'apps/web/src/components/landing/VividHero.tsx',
  'apps/web/src/components/landing/capabilities.ts',
  'apps/web/src/components/landing/FamilyStory.tsx',
  'apps/web/src/lib/site-copy.ts',
  'apps/web/src/app/domains/page.tsx',
  'apps/web/src/app/domains/RecordList.tsx',
  'apps/web/src/app/domains/AddRecordForm.tsx',
  'apps/web/src/components/EditAccessSwitch.tsx',
  'apps/api/src/delivery/notification-catalogue.ts',
  'apps/web/src/components/landing/AuthIntro.tsx',
].filter((f) => fs.existsSync(path.join(ROOT, f)))

/** Words a family should not have to decode. */
const JARGON =
  /\b(adapter|manifest|entitlement|tier|ledger|payload|schema|matrix|handover brief|result version|idempotent|provenance)\b/i

describe('the scorer', () => {
  it('rates short plain sentences easy and dense ones hard', () => {
    expect(grade('Your partner sees the same answer as you do.')).toBeLessThan(6)
    expect(
      grade(
        'Notwithstanding contractual indemnification obligations, beneficiaries nominated retrospectively require reconfirmation.',
      ),
    ).toBeGreaterThan(14)
  })
  it('counts syllables roughly right', () => {
    expect(syllables('policy')).toBe(3)
    expect(syllables('renewal')).toBe(3)
    expect(syllables('cat')).toBe(1)
  })
})

describe('family-facing copy stays plain', () => {
  it('scans the files that exist', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5)
  })

  for (const f of FILES) {
    it(`${f}: every sentence reads at grade ${MAX_GRADE} or below, with no jargon`, () => {
      const src = fs
        .readFileSync(path.join(ROOT, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
      const sentences = copyIn(src, f.endsWith('.tsx'))
      const hard = sentences
        .map((s) => ({ s, g: grade(s) }))
        .filter((x) => x.g > MAX_GRADE)
        .map((x) => `${x.g.toFixed(1)}: ${x.s}`)
      expect(hard, 'too hard to read').toEqual([])
      const jargon = sentences.filter((s) => JARGON.test(s))
      expect(jargon, 'jargon in family-facing copy').toEqual([])
    })
  }
})
