/**
 * Enforces CLAUDE.md's "second rule": LifeKeel never crosses into regulated
 * advice or arranging. Detector and playbook copy describe what is on file and
 * point to "a licensed professional" — never "buy X", never a named provider.
 *
 * This is a tripwire for the obvious failures, not a compliance review: it
 * catches recommendation verbs and named providers in declarative copy. A
 * human reviewer still owns the judgement call on subtler phrasing.
 *
 * Only non-comment lines are scanned, so YAML comments that explain *why* a
 * rule exists can quote banned phrases freely.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const BANNED: Array<{ name: string; pattern: RegExp }> = [
  { name: 'personal recommendation', pattern: /\b(you should|we recommend|i recommend|we suggest you)\b/i },
  { name: 'buy/switch instruction', pattern: /\b(buy|purchase|switch to|sign up (with|for)|take out)\b/i },
  { name: 'best-product claim', pattern: /\bbest (policy|provider|insurer|fund|product|plan)\b/i },
  {
    name: 'named provider',
    pattern: /\b(aviva|legal (&|and) general|vitality|prudential|zurich|axa|hargreaves lansdown|vanguard|fidelity|nutmeg|moneybox)\b/i,
  },
]

function copyFiles(): string[] {
  const dirs = ['detectors/family', 'playbooks/family']
  return dirs.flatMap((d) =>
    fs
      .readdirSync(path.join(ROOT, d))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => path.join(d, f)),
  )
}

export function findViolations(file: string, text: string): string[] {
  const out: string[] = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return
    for (const { name, pattern } of BANNED) {
      if (pattern.test(line)) out.push(`${file}:${i + 1} [${name}] ${line.trim()}`)
    }
  })
  return out
}

describe('advice rule (CLAUDE.md second rule)', () => {
  it('scans at least the detector and playbook copy', () => {
    expect(copyFiles().length).toBeGreaterThan(10)
  })

  it('no detector or playbook copy reads as a personal recommendation', () => {
    const violations = copyFiles().flatMap((f) =>
      findViolations(f, fs.readFileSync(path.join(ROOT, f), 'utf8')),
    )
    expect(violations).toEqual([])
  })

  it('the checker itself catches advice-like copy (test would fail without it)', () => {
    expect(findViolations('x.yaml', 'reasoning_template: You should buy Aviva term cover')).toHaveLength(3)
    expect(findViolations('x.yaml', '# you should buy this — comment only')).toEqual([])
    expect(findViolations('x.yaml', 'Compare quotes from multiple insurers')).toEqual([])
  })
})
