/**
 * Keeps the process docs true. Every relative markdown link, every #anchor into another
 * doc, and every repo path named in backticks must exist, so moving or deleting a file
 * that a doc names fails CI until the doc is updated.
 *
 * Escape hatch: a line that says the thing was removed, or shows how to restore it
 * ("removed", "restored from", "git show"), is not path-checked, because it names a file
 * on purpose precisely because it is gone.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const DOCS = [
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'docs/README.md',
  'docs/ai-native-sdlc-playbook.md',
  'docs/local-testing.md',
  ...fs
    .readdirSync(path.join(ROOT, 'docs/sdlc'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/sdlc/${f}`),
]

const ROOTS =
  '(?:apps|packages|scripts|docs|detectors|playbooks|verticals|connectors|detector-evals|infra|\\.github|\\.claude)'
const PATH_IN_TICKS = new RegExp('`(' + ROOTS + '/[^\\s`]+)`', 'g')
const REMOVED_LINE = /\b(removed|restored? from|git show)\b/i

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))

/** GitHub's heading slug: lowercase, drop punctuation, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-')
}

function anchors(rel: string): Set<string> {
  const out = new Set<string>()
  for (const line of read(rel).split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line)
    if (m) out.add(slug(m[1] ?? ''))
  }
  return out
}

function isCheckable(p: string): boolean {
  return !/[*<>{}]|NNN|(^|\/)dist(\/|$)|(^|\/)\.next(\/|$)|node_modules/.test(p)
}

describe('process docs stay true', () => {
  it('has docs to check', () => {
    expect(DOCS.length).toBeGreaterThan(5)
    for (const d of DOCS) expect(exists(d), d).toBe(true)
  })

  it('every relative link and anchor resolves', () => {
    const problems: string[] = []
    for (const doc of DOCS) {
      const dir = path.dirname(doc)
      read(doc)
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
            const href = m[1] ?? ''
            if (/^(https?:|mailto:)/.test(href)) continue
            const [file, anchor] = href.split('#')
            const target = file ? path.normalize(path.join(dir, file)) : doc
            if (!exists(target)) {
              problems.push(`${doc}:${i + 1} missing link target ${href}`)
              continue
            }
            if (anchor && target.endsWith('.md') && !anchors(target).has(anchor)) {
              problems.push(`${doc}:${i + 1} missing anchor #${anchor} in ${target}`)
            }
          }
        })
    }
    expect(problems).toEqual([])
  })

  it('every repo path named in backticks exists', () => {
    const problems: string[] = []
    for (const doc of DOCS) {
      read(doc)
        .split('\n')
        .forEach((line, i) => {
          if (REMOVED_LINE.test(line)) return
          for (const m of line.matchAll(PATH_IN_TICKS)) {
            const p = (m[1] ?? '').replace(/[.,;:)]+$/, '').replace(/:\d+$/, '')
            if (isCheckable(p) && !exists(p))
              problems.push(`${doc}:${i + 1} names \`${p}\` which does not exist`)
          }
        })
    }
    expect(problems).toEqual([])
  })

  it('every workflow file is described in the process docs', () => {
    const corpus = ['docs/ai-native-sdlc-playbook.md', 'docs/sdlc/status.md', 'CONTRIBUTING.md']
      .map(read)
      .join('\n')
    const workflows = fs
      .readdirSync(path.join(ROOT, '.github/workflows'))
      .filter((f) => f.endsWith('.yml'))
    expect(workflows.length).toBeGreaterThan(5)
    const undocumented = workflows.filter((w) => !corpus.includes(w))
    expect(undocumented).toEqual([])
  })

  it('every gap id cited in the docs is defined in status.md', () => {
    const defined = new Set(
      [...read('docs/sdlc/status.md').matchAll(/^\| (G\d+) \|/gm)].map((m) => m[1]),
    )
    expect(defined.size).toBeGreaterThan(10)
    const cited = new Set<string>()
    for (const doc of DOCS) for (const m of read(doc).matchAll(/\bG\d{1,2}\b/g)) cited.add(m[0])
    const missing = [...cited].filter((g) => !defined.has(g))
    expect(missing).toEqual([])
  })

  it('the checker itself notices a broken path and a bad anchor (test would fail without it)', () => {
    expect(
      isCheckable('apps/api/src/does-not-exist.ts') && !exists('apps/api/src/does-not-exist.ts'),
    ).toBe(true)
    expect(slug("2. Cover a new way to act on a family's or tenant's behalf")).toBe(
      '2-cover-a-new-way-to-act-on-a-familys-or-tenants-behalf',
    )
    expect(anchors('docs/sdlc/extending.md').has('no-such-heading')).toBe(false)
  })
})
