import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// Emergency mode is one or two taps from every screen where someone looks for
// their cover or their next steps. There is no floating button, so each of
// these carries its own row (or, on Family, a list row).
const SCREENS = [
  'app/page.tsx',
  'app/events/page.tsx',
  'app/domains/page.tsx',
  'app/family/page.tsx',
]

describe('emergency entry on the primary screens', () => {
  for (const rel of SCREENS) {
    it(`${rel} offers Emergency mode`, () => {
      expect(read(rel)).toMatch(/<EmergencyRow\b|activateEmergency\(\)/)
    })
  }
})
