/**
 * IMS GAP-REGISTER FITNESS TEST (ISO_AUDITABLE.md §15, §16 Phase 0 step 2)
 *
 * docs/ims/gap-register.yaml is the tracker for every gap ISO_AUDITABLE.md
 * §15 names. This test keeps the two from drifting: a G-ID added to §15 must
 * be tracked, a status cannot be invented, and nothing can be marked closed
 * without evidence that exists on disk.
 *
 * Like architecture-claims.test.ts, this is a tripwire, not proof: it checks
 * that a closed gap points at real files, not that those files close it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { load as loadYaml } from 'js-yaml'

const REPO_ROOT = resolve(__dirname, '../../../..')

function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

const SEVERITIES = ['S1', 'S2', 'S3', 'S4'] as const
const STATUSES = ['open', 'in_progress', 'closed', 'verify'] as const
type Severity = (typeof SEVERITIES)[number]

interface GapEntry {
  id: string
  title: string
  severity: string
  clauses: string[]
  owner_role: string
  phase: number
  status: string
  evidence: string[] | string
  exit_criterion: string
}

/** §15 G-IDs with the severity of the subsection they appear in. */
function gapIdsFromIsoDoc(): Map<string, Severity> {
  const doc = readSrc('ISO_AUDITABLE.md')
  const start = doc.indexOf('\n## 15.')
  const end = doc.indexOf('\n## 16.', start)
  expect(start, '§15 heading not found in ISO_AUDITABLE.md').toBeGreaterThan(0)
  expect(end, '§16 heading not found after §15').toBeGreaterThan(start)
  const ids = new Map<string, Severity>()
  let severity: Severity | null = null
  for (const line of doc.slice(start, end).split('\n')) {
    const heading = /^### 15\.\d+ (S[1-4])\b/.exec(line)
    if (heading) severity = heading[1] as Severity
    const row = /^\|\s*(G-[A-Z]+-\d+)\s*\|/.exec(line)
    if (row && severity) ids.set(row[1], severity)
  }
  return ids
}

function evidenceList(e: GapEntry): string[] {
  return Array.isArray(e.evidence) ? e.evidence : []
}

const register = loadYaml(readSrc('docs/ims/gap-register.yaml')) as { gaps: GapEntry[] }
const gaps = register.gaps
const isoIds = gapIdsFromIsoDoc()

describe('IMS gap register mirrors ISO_AUDITABLE.md §15', () => {
  it('parses a non-trivial set of G-IDs from §15', () => {
    expect(isoIds.size).toBeGreaterThanOrEqual(40)
  })

  it('tracks every §15 G-ID', () => {
    const tracked = new Set(gaps.map((g) => g.id))
    const missing = [...isoIds.keys()].filter((id) => !tracked.has(id)).sort()
    expect(missing, 'G-IDs in §15 missing from docs/ims/gap-register.yaml').toEqual([])
  })

  it('has no ids that §15 does not define', () => {
    const unknown = gaps.map((g) => g.id).filter((id) => !isoIds.has(id))
    expect(unknown, 'register ids not present in §15').toEqual([])
  })

  it('has no duplicate ids', () => {
    const seen = new Set<string>()
    const dupes = gaps
      .map((g) => g.id)
      .filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
    expect(dupes).toEqual([])
  })

  it('uses the severity of the §15 subsection each gap is listed under', () => {
    const wrong = gaps
      .filter((g) => isoIds.has(g.id) && isoIds.get(g.id) !== g.severity)
      .map((g) => `${g.id}: ${g.severity} != ${isoIds.get(g.id)}`)
    expect(wrong).toEqual([])
  })
})

describe('IMS gap register entries are well-formed', () => {
  for (const g of gaps) {
    it(`${g.id} has valid fields`, () => {
      expect(SEVERITIES as readonly string[]).toContain(g.severity)
      expect(STATUSES as readonly string[]).toContain(g.status)
      expect(g.title, 'title').toBeTruthy()
      expect(g.owner_role, 'owner_role').toBeTruthy()
      expect(g.exit_criterion, 'exit_criterion').toBeTruthy()
      expect(Array.isArray(g.clauses) && g.clauses.length > 0, 'clauses').toBe(true)
      expect(Number.isInteger(g.phase) && g.phase >= 0 && g.phase <= 5, 'phase 0–5').toBe(true)
      if (!Array.isArray(g.evidence)) expect(g.evidence, 'evidence is a list or "—"').toBe('—')
    })

    it(`${g.id} evidence paths exist`, () => {
      const missing = evidenceList(g).filter((p) => !existsSync(resolve(REPO_ROOT, p)))
      expect(missing).toEqual([])
    })

    if (g.status === 'closed') {
      it(`${g.id} is closed with at least one evidence path`, () => {
        expect(evidenceList(g).length).toBeGreaterThan(0)
      })
    }
  }
})
