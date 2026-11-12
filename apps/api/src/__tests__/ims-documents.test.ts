/**
 * IMS DOCUMENTS FITNESS TEST (ISO_AUDITABLE.md §16 Phase 1)
 *
 * Keeps the management-system records under docs/ims/ structurally honest:
 *  - every AI task in definitions/ai-tasks.yaml has an impact assessment;
 *  - both Statements of Applicability list exactly the Annex A controls of
 *    their standard (93 / 38), once each, with evidence paths that exist;
 *  - every risk is scored, owned, treated and linked to real gaps/controls;
 *  - every governed document carries the document-control header, and none
 *    claims approval without naming it.
 *
 * Tripwires, not proof: they check the records are complete and consistent,
 * not that their content is right. Approval is a human act this test cannot
 * see — it only refuses a status that says APPROVED with no approval recorded.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, resolve, relative } from 'path'
import { load as loadYaml } from 'js-yaml'

const REPO_ROOT = resolve(__dirname, '../../../..')

function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

function loadDoc<T>(rel: string): T {
  return loadYaml(readSrc(rel)) as T
}

function* filesUnder(dir: string, ext: string[]): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* filesUnder(p, ext)
    else if (ext.some((e) => entry.endsWith(e))) yield p
  }
}

const missingPaths = (paths: string[]): string[] =>
  paths.filter((p) => !existsSync(resolve(REPO_ROOT, p)))

/* ------------------------------------------------------------------ */
/* Shapes                                                               */
/* ------------------------------------------------------------------ */

interface DocHeader {
  id: string
  version: string
  status: string
  owner: string
  approver: string
  approved: string
  next_review: string
}

interface SoaControl {
  id: string
  title: string
  applicable: string
  justification: string
  implementation_status: string
  evidence: string[]
  linked_risks: string[]
  linked_gaps: string[]
}

interface Risk {
  id: string
  title: string
  assets: string[]
  ai_systems?: string[]
  likelihood: number
  impact: number
  score: number
  level: string
  control_evidence: string[]
  treatment: { option: string; plan: string }
  annex_a: string[]
  aims_controls: string[]
  linked_gaps: string[]
  owner_role: string
  acceptance: string
}

interface Assessment {
  task_id: string
  [field: string]: unknown
}

const tasks = Object.keys(
  loadDoc<{ tasks: Record<string, unknown> }>('definitions/ai-tasks.yaml').tasks,
)
const gapIds = new Set(
  loadDoc<{ gaps: { id: string }[] }>('docs/ims/gap-register.yaml').gaps.map((g) => g.id),
)
const soa27 = loadDoc<{ document: DocHeader; controls: SoaControl[] }>(
  'docs/ims/soa/iso27001-soa.yaml',
)
const soa42 = loadDoc<{ document: DocHeader; controls: SoaControl[] }>(
  'docs/ims/soa/iso42001-soa.yaml',
)
const riskDoc = loadDoc<{ document: DocHeader; risks: Risk[] }>('docs/ims/risk/risk-register.yaml')
const aiia = loadDoc<{ document: DocHeader; assessments: Assessment[] }>(
  'docs/ims/ai-impact/assessments.yaml',
)

/* ------------------------------------------------------------------ */
/* AI system impact assessments (42001 6.1.4)                          */
/* ------------------------------------------------------------------ */

// ISO_AUDITABLE.md §23.4 record fields.
const AIIA_FIELDS = [
  'system',
  'version',
  'owner',
  'intended_use',
  'prohibited_or_foreseeable_misuse',
  'affected_people',
  'children',
  'special_category',
  'data_in',
  'data_out',
  'processors',
  'retention_class',
  'autonomy_trust_tier',
  'human_oversight_point',
  'risks',
  'fairness_accessibility',
  'transparency_to_users',
  'evaluations_and_thresholds',
  'residual_risk',
  'decision',
  'reassessment_trigger',
  'sign_off',
]

describe('IMS: AI system impact assessments', () => {
  const assessed = aiia.assessments.map((a) => a.task_id)

  it('has an assessment for every task_id in definitions/ai-tasks.yaml', () => {
    expect(tasks.filter((t) => !assessed.includes(t)).sort()).toEqual([])
  })

  it('has no assessment for a task that is not registered, and none twice', () => {
    expect(assessed.filter((t) => !tasks.includes(t))).toEqual([])
    expect(new Set(assessed).size).toBe(assessed.length)
  })

  for (const a of aiia.assessments) {
    it(`${a.task_id} fills every §23.4 field`, () => {
      const empty = AIIA_FIELDS.filter((f) => a[f] === undefined || a[f] === null || a[f] === '')
      expect(empty).toEqual([])
    })
  }

  it('cites only risks that exist in the register', () => {
    const riskIds = new Set(riskDoc.risks.map((r) => r.id))
    const cited = aiia.assessments.flatMap((a) => (a.risks as string[]).map((r) => r.split(' ')[0]))
    expect(cited.filter((r) => !riskIds.has(r))).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Statements of Applicability                                          */
/* ------------------------------------------------------------------ */

function expected27001(): string[] {
  const ranges: [number, number][] = [
    [5, 37],
    [6, 8],
    [7, 14],
    [8, 34],
  ]
  return ranges.flatMap(([theme, n]) => Array.from({ length: n }, (_, i) => `A.${theme}.${i + 1}`))
}

// ISO/IEC 42001:2023 Annex A control identifiers.
const EXPECTED_42001 = [
  'A.2.2',
  'A.2.3',
  'A.2.4',
  'A.3.2',
  'A.3.3',
  'A.4.2',
  'A.4.3',
  'A.4.4',
  'A.4.5',
  'A.4.6',
  'A.5.2',
  'A.5.3',
  'A.5.4',
  'A.5.5',
  'A.6.1.2',
  'A.6.1.3',
  'A.6.2.2',
  'A.6.2.3',
  'A.6.2.4',
  'A.6.2.5',
  'A.6.2.6',
  'A.6.2.7',
  'A.6.2.8',
  'A.7.2',
  'A.7.3',
  'A.7.4',
  'A.7.5',
  'A.7.6',
  'A.8.2',
  'A.8.3',
  'A.8.4',
  'A.8.5',
  'A.9.2',
  'A.9.3',
  'A.9.4',
  'A.10.2',
  'A.10.3',
  'A.10.4',
]

const IMPL_STATUSES = ['implemented', 'partial', 'not_implemented', 'inherited']

for (const [name, soa, expected] of [
  ['ISO/IEC 27001', soa27, expected27001()],
  ['ISO/IEC 42001', soa42, EXPECTED_42001],
] as const) {
  describe(`IMS: ${name} Statement of Applicability`, () => {
    const ids = soa.controls.map((c) => c.id)

    it(`lists exactly ${expected.length} controls`, () => {
      expect(soa.controls.length).toBe(expected.length)
    })

    it('has unique control ids matching the standard', () => {
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual([...expected].sort())
    })

    it('states applicability, justification and a valid implementation status', () => {
      const bad = soa.controls
        .filter(
          (c) =>
            !['Y', 'N'].includes(c.applicable) ||
            !c.justification ||
            !IMPL_STATUSES.includes(c.implementation_status),
        )
        .map((c) => c.id)
      expect(bad).toEqual([])
    })

    it('marks implemented controls only with evidence', () => {
      const bare = soa.controls
        .filter((c) => c.implementation_status === 'implemented' && c.evidence.length === 0)
        .map((c) => c.id)
      expect(bare).toEqual([])
    })

    it('cites evidence paths that exist', () => {
      expect(missingPaths(soa.controls.flatMap((c) => c.evidence))).toEqual([])
    })

    it('links only gaps that exist in the gap register', () => {
      const unknown = soa.controls.flatMap((c) => c.linked_gaps).filter((g) => !gapIds.has(g))
      expect(unknown).toEqual([])
    })
  })
}

/* ------------------------------------------------------------------ */
/* Risk register                                                         */
/* ------------------------------------------------------------------ */

function levelFor(score: number): string {
  if (score <= 4) return 'Low'
  if (score <= 9) return 'Medium'
  if (score <= 16) return 'High'
  return 'Critical'
}

describe('IMS: risk register', () => {
  const risks = riskDoc.risks
  const soa27Ids = new Set(soa27.controls.map((c) => c.id))
  const soa42Ids = new Set(soa42.controls.map((c) => c.id))

  it('has at least 40 risks with unique ids', () => {
    expect(risks.length).toBeGreaterThanOrEqual(40)
    expect(new Set(risks.map((r) => r.id)).size).toBe(risks.length)
  })

  for (const r of risks) {
    it(`${r.id} is scored, owned, treated and pending acceptance`, () => {
      expect(r.owner_role, 'owner_role').toBeTruthy()
      expect([1, 2, 3, 4, 5]).toContain(r.likelihood)
      expect([1, 2, 3, 4, 5]).toContain(r.impact)
      expect(r.score, 'score = likelihood × impact').toBe(r.likelihood * r.impact)
      expect(r.level).toBe(levelFor(r.score))
      expect(['modify', 'avoid', 'share', 'retain']).toContain(r.treatment?.option)
      expect(r.treatment?.plan, 'treatment plan').toBeTruthy()
      expect(r.acceptance, 'acceptance').toBeTruthy()
    })
  }

  it('cites control evidence paths that exist', () => {
    expect(missingPaths(risks.flatMap((r) => r.control_evidence))).toEqual([])
  })

  it('links only gaps, Annex A controls and AI tasks that exist', () => {
    expect(risks.flatMap((r) => r.linked_gaps).filter((g) => !gapIds.has(g))).toEqual([])
    expect(risks.flatMap((r) => r.annex_a).filter((c) => !soa27Ids.has(`A.${c}`))).toEqual([])
    expect(risks.flatMap((r) => r.aims_controls).filter((c) => !soa42Ids.has(c))).toEqual([])
    expect(risks.flatMap((r) => r.ai_systems ?? []).filter((t) => !tasks.includes(t))).toEqual([])
  })

  it('covers every AI task with at least one risk', () => {
    const covered = new Set(risks.flatMap((r) => r.ai_systems ?? []))
    expect(tasks.filter((t) => !covered.has(t))).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Document-control headers (G-DOC-01)                                   */
/* ------------------------------------------------------------------ */

const MD_FIELDS = [
  'Document ID',
  'Version',
  'Status',
  'Owner',
  'Approver',
  'Approved',
  'Next review',
] as const

function mdHeader(src: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const f of MD_FIELDS) {
    const m = new RegExp(`^\\| ${f} \\| (.+?) \\|\\s*$`, 'm').exec(src)
    if (m) fields.set(f, m[1].trim())
  }
  return fields
}

function yamlHeader(rel: string): Map<string, string> {
  const doc = loadDoc<{ document?: Partial<DocHeader> }>(rel).document ?? {}
  const fields = new Map<string, string>()
  const keys: [(typeof MD_FIELDS)[number], keyof DocHeader][] = [
    ['Document ID', 'id'],
    ['Version', 'version'],
    ['Status', 'status'],
    ['Owner', 'owner'],
    ['Approver', 'approver'],
    ['Approved', 'approved'],
    ['Next review', 'next_review'],
  ]
  for (const [label, key] of keys) {
    const v = doc[key]
    if (v !== undefined && v !== null && String(v) !== '') fields.set(label, String(v))
  }
  return fields
}

describe('IMS: governed documents carry the document-control header', () => {
  const governed = [
    ...filesUnder(resolve(REPO_ROOT, 'docs/ims'), ['.md', '.yaml', '.yml']),
    ...filesUnder(resolve(REPO_ROOT, 'docs/runbooks'), ['.md']),
  ].map((p) => relative(REPO_ROOT, p))
  const headers = new Map(
    governed.map((rel) => [rel, rel.endsWith('.md') ? mdHeader(readSrc(rel)) : yamlHeader(rel)]),
  )

  it('finds the governed documents', () => {
    expect(governed.length).toBeGreaterThanOrEqual(30)
  })

  for (const [rel, h] of headers) {
    it(`${rel} has every header field`, () => {
      expect(MD_FIELDS.filter((f) => !h.has(f))).toEqual([])
    })

    it(`${rel} does not claim approval without recording it`, () => {
      const approved = h.get('Approved') ?? '—'
      if (approved === '—') expect(h.get('Status')).toMatch(/^DRAFT/)
    })
  }

  it('uses each document ID once', () => {
    const ids = [...headers.values()].map((h) => h.get('Document ID'))
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Phase 3 records: NC log (G-DOC-02) and objectives (6.2 / 9.1)        */
/* ------------------------------------------------------------------ */

interface NcEntry {
  id: string
  raised: string
  raised_by: string
  clause: string[]
  severity: string
  description: string
  root_cause: string
  corrective_action: string
  owner: string
  effectiveness_check: string
  status: string
  links: string[]
}

describe('IMS: nonconformity log', () => {
  const entries = loadDoc<{ entries: NcEntry[] }>('docs/ims/nc-log.yaml').entries
  const gapIds = new Set(
    loadDoc<{ gaps: { id: string }[] }>('docs/ims/gap-register.yaml').gaps.map((g) => g.id),
  )
  const riskIds = new Set(
    loadDoc<{ risks: { id: string }[] }>('docs/ims/risk/risk-register.yaml').risks.map((r) => r.id),
  )

  it('has uniquely numbered entries', () => {
    expect(entries.length).toBeGreaterThan(0)
    const ids = entries.map((e) => e.id)
    for (const id of ids) expect(id).toMatch(/^NC-\d{4}-\d{3}$/)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const e of entries) {
    it(`${e.id} is graded, owned and linked to things that exist`, () => {
      expect(['S1', 'S2', 'S3', 'S4']).toContain(e.severity)
      expect(['open', 'closed']).toContain(e.status)
      expect(e.raised).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(e.description.length).toBeGreaterThan(40)
      expect(e.owner).toMatch(/\(role\)$/)
      expect(e.clause.length).toBeGreaterThan(0)
      for (const l of e.links) expect(gapIds.has(l) || riskIds.has(l), l).toBe(true)
    })

    if (e.status === 'closed') {
      it(`${e.id} is closed only with a root cause and a verified effectiveness check`, () => {
        for (const f of [e.root_cause, e.corrective_action, e.effectiveness_check])
          expect(f).not.toBe('—')
      })
    }
  }
})

describe('IMS: objectives', () => {
  const src = readSrc('docs/ims/objectives.md')

  it('lists O1–O15 from ISO_AUDITABLE.md §20, once each, with an owner', () => {
    for (let i = 1; i <= 15; i++) {
      const rows = src.split('\n').filter((l) => l.startsWith(`| O${i} |`))
      expect(rows, `O${i}`).toHaveLength(1)
      expect(rows[0]!.trim()).toMatch(/\| [^|]+ \|$/)
    }
  })
})
