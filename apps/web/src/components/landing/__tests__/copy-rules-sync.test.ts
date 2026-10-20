/**
 * definitions/marketing-copy-rules.json is what the API's marketing copy guard reads. It is generated
 * from the claims registry (the single source of truth) so the two cannot drift. If this fails after
 * editing claims.ts, regenerate with:  UPDATE_COPY_RULES=1 pnpm --filter @lifekeel/web exec vitest run copy-rules-sync
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CLAIMS } from '../claims'

const FILE = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'definitions', 'marketing-copy-rules.json')

function expected() {
  return {
    _generated_from: 'apps/web/src/components/landing/claims.ts (blocked claims). Do not edit by hand.',
    blocked_phrases: CLAIMS.filter((c) => c.status === 'blocked').flatMap((c) =>
      (c.forbidden ?? []).map((phrase) => ({ claim: c.id, phrase })),
    ),
  }
}

describe('marketing copy rules', () => {
  it('matches the claims registry', () => {
    const want = JSON.stringify(expected(), null, 2) + '\n'
    if (process.env['UPDATE_COPY_RULES']) fs.writeFileSync(FILE, want)
    expect(fs.readFileSync(FILE, 'utf8')).toBe(want)
  })
  it('has at least one blocked phrase', () => {
    expect(expected().blocked_phrases.length).toBeGreaterThan(0)
  })
})
