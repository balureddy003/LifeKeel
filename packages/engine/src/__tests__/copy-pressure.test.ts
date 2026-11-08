/**
 * Companion to advice-rule.test.ts: nudge copy must not press, scold or scare.
 * Messages that ask a family to act (invite, digest offer, reminders) state a
 * fact and offer a choice. This scans those files for fear, guilt and streak
 * phrases, and keeps the product name consistent on the invite page.
 * A tripwire for the obvious cases; a human still reads the tone.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const PRESSURE: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'conditional fear appeal',
    pattern: /only helps if|before it.?s too late|if something happens to you/i,
  },
  {
    name: 'scold about not opening',
    pattern: /haven.?t (opened|read|looked|visited|replied|responded)/i,
  },
  {
    name: 'false urgency',
    pattern: /don.?t miss|running out of time|act now|last chance|falling behind|at risk/i,
  },
  {
    name: 'guilt or waiting-on-you',
    pattern: /your (family|partner|spouse) is waiting|let (them|your family) down/i,
  },
  {
    name: 'streak or days-away counting',
    pattern: /\bstreak\b|days since|since your last (visit|login)|welcome back after/i,
  },
]

const FILES = [
  'apps/web/src/components/InvitePartnerPrompt.tsx',
  'apps/web/src/components/NotificationsCard.tsx',
  'apps/web/src/app/invite/[code]/InviteJoinClient.tsx',
  'apps/web/src/components/ThreeDoors.tsx',
  'apps/api/src/feed/render-quiet-care.ts',
  'apps/api/src/delivery/notification-catalogue.ts',
].filter((f) => fs.existsSync(path.join(ROOT, f)))

const code = (f: string) =>
  fs
    .readFileSync(path.join(ROOT, f), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

describe('nudge copy stays calm', () => {
  it('scans the files that exist', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(4)
  })

  for (const f of FILES) {
    it(`${f} has no pressure phrases`, () => {
      const src = code(f)
      for (const { name, pattern } of PRESSURE) expect(src, `${f}: ${name}`).not.toMatch(pattern)
    })
  }

  it('names the product LifeKeel on the invite page', () => {
    const src = code('apps/web/src/app/invite/[code]/InviteJoinClient.tsx')
    expect(src).not.toMatch(/\b(an? )?Keel account\b/)
    expect(src).not.toMatch(/on Keel['"`]/)
    expect(src).toMatch(/on LifeKeel/)
  })
})
