/**
 * IMS CERTIFICATION READINESS GATE (ISO_AUDITABLE.md §16 Phase 4, §22)
 *
 * docs/ims/certification/stage1-readiness.md is the checklist the IMS manager
 * shows the CEO before booking a Stage 1 audit. This test keeps it honest:
 *  - every path a row cites exists;
 *  - a row's status is READY or NOT READY, nothing else;
 *  - a READY row lists no blocking gap, and every gap it would list is real;
 *  - a READY row cites no document whose header still records no approval.
 *
 * Tripwire, not proof: it cannot tell whether a READY record is good enough,
 * only that the checklist does not claim approval the documents do not show.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, resolve, relative } from 'path'
import { load as loadYaml } from 'js-yaml'

const REPO_ROOT = resolve(__dirname, '../../../..')
const CHECKLIST = 'docs/ims/certification/stage1-readiness.md'

function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

interface Row {
  id: string
  paths: string[]
  status: string
  blocking: string[]
}

function checklistRows(): Row[] {
  return readSrc(CHECKLIST)
    .split('\n')
    .filter((l) => /^\| S1-\d{2} \|/.test(l))
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim())
      // ['', id, item, clauses, path, status, blocking, '']
      const [, id = '', , , path = '', status = '', blocking = ''] = cells
      return {
        id,
        paths: [...path.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? ''),
        status,
        blocking: blocking === '—' ? [] : blocking.split(',').map((g) => g.trim()),
      }
    })
}

function* docsUnder(abs: string): Generator<string> {
  if (!existsSync(abs)) return
  if (!statSync(abs).isDirectory()) {
    yield abs
    return
  }
  for (const entry of readdirSync(abs)) yield* docsUnder(join(abs, entry))
}

/** A cited document is unapproved if its header records no approval or a draft status. */
function unapproved(abs: string): boolean {
  if (abs.endsWith('.yaml') || abs.endsWith('.yml')) {
    const doc = (loadYaml(readFileSync(abs, 'utf8')) as { document?: Record<string, unknown> })
      ?.document
    if (!doc) return false
    return String(doc['approved'] ?? '—') === '—' || /draft/i.test(String(doc['status'] ?? ''))
  }
  if (!abs.endsWith('.md')) return false
  const head = readFileSync(abs, 'utf8').split('\n').slice(0, 30).join('\n')
  const approved = /^\| Approved \| (.+?) \|\s*$/m.exec(head)?.[1]?.trim()
  const status = /^\| Status \| (.+?) \|\s*$/m.exec(head)?.[1] ?? /^Status: (.+)$/m.exec(head)?.[1]
  return approved === '—' || /draft/i.test(status ?? '')
}

const rows = checklistRows()
const gapIds = new Set(
  (loadYaml(readSrc('docs/ims/gap-register.yaml')) as { gaps: { id: string }[] }).gaps.map(
    (g) => g.id,
  ),
)

describe('IMS: Stage 1 readiness checklist', () => {
  it('has uniquely numbered rows covering §19 and §16 step 22', () => {
    expect(rows.length).toBeGreaterThanOrEqual(29)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it('cites only paths that exist', () => {
    const missing = rows.flatMap((r) =>
      r.paths.filter((p) => !existsSync(resolve(REPO_ROOT, p))).map((p) => `${r.id}: ${p}`),
    )
    expect(missing).toEqual([])
  })

  it('uses READY or NOT READY and links only real gaps', () => {
    expect(rows.filter((r) => !['READY', 'NOT READY'].includes(r.status)).map((r) => r.id)).toEqual(
      [],
    )
    const unknown = rows.flatMap((r) => r.blocking.filter((g) => !gapIds.has(g)))
    expect(unknown).toEqual([])
  })

  it('marks a row NOT READY while it has blocking gaps', () => {
    expect(
      rows.filter((r) => r.status === 'READY' && r.blocking.length > 0).map((r) => r.id),
    ).toEqual([])
  })

  it('marks a row READY only when every cited document records its approval', () => {
    const premature = rows
      .filter((r) => r.status === 'READY')
      .flatMap((r) =>
        r.paths
          .flatMap((p) => [...docsUnder(resolve(REPO_ROOT, p))])
          .filter(unapproved)
          .map((abs) => `${r.id}: ${relative(REPO_ROOT, abs)}`),
      )
    expect(premature).toEqual([])
  })

  it('does not declare the verdict READY while any row is NOT READY', () => {
    const verdict = /^## Verdict: (.+)$/m.exec(readSrc(CHECKLIST))?.[1]?.trim()
    const anyOpen = rows.some((r) => r.status !== 'READY')
    expect(verdict).toBe(anyOpen ? 'NOT READY' : 'READY')
  })
})
