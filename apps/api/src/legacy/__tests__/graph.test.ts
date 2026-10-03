/**
 * PRD-137 §5 — the legacy graph read model: visibility-scoped nodes and
 * edges, verification labels on every claim, youth existence-only mode,
 * and the ≤1,200-char assistant rendering.
 */
import { describe, expect, it } from 'vitest'
import { buildLegacyGraph, renderLegacyGraphForAssistant, type LegacyGraphViewer } from '../graph.js'

const TENANT = 't1'

const ADULT_VIEWER: LegacyGraphViewer = { user_id: 'u-adult', is_organizer: false, member_id: 'm-adult', youth: false }
const ORG_VIEWER: LegacyGraphViewer = { user_id: 'u-org', is_organizer: true, member_id: 'm-org', youth: false }
const YOUTH_VIEWER: LegacyGraphViewer = { user_id: 'u-kid', is_organizer: false, member_id: 'm-kid', youth: true }

const family = {
  tenant_id: TENANT,
  members: [
    { id: 'm-org', user_id: 'u-org', name: 'Organizer', role: 'organizer', status: 'active' },
    { id: 'm-adult', user_id: 'u-adult', name: 'Adult', role: 'adult', status: 'active' },
    { id: 'm-kid', user_id: 'u-kid', name: 'Kid', role: 'child', status: 'active' },
  ],
}

const willForOrg = {
  id: 'd-will', tenant_id: TENANT, type: 'will', subject_member_id: 'm-org',
  jurisdiction: 'England & Wales', signed_on: '2019-03-01', last_reviewed_on: '2019-03-01',
  original_location: 'Solicitor X, Leeds',
  roles: [
    { role: 'executor', member_id: 'm-adult', verification: 'user_declared' },
    { role: 'trustee', contact_id: 'c-sol', verification: 'document_linked' },
  ],
  covers_asset_ids: ['a-home'], verification: 'document_linked', visibility: 'adults',
  created_by: 'u-org', created_at: new Date(), updated_at: new Date(),
}

const orgOnlyDoc = {
  id: 'd-secret', tenant_id: TENANT, type: 'letter_of_wishes', subject_member_id: 'm-org',
  jurisdiction: 'England & Wales', roles: [], covers_asset_ids: [],
  verification: 'user_declared', visibility: 'organizer',
  created_by: 'u-org', created_at: new Date(), updated_at: new Date(),
}

const property = {
  id: 'a-home', tenant_id: TENANT, kind: 'property', name: 'Ancestral home',
  value_minor: 99_000_000, created_at: new Date(), updated_at: new Date(),
  legacy: {
    ownership_basis: 'inherited', jurisdiction: 'Telangana IN',
    recorded_owners: [{ role: 'beneficiary', member_id: 'm-org', share_pct: 50, verification: 'document_linked' }],
    claimed_owners: [{ role: 'beneficiary', contact_id: 'c-aunt', share_pct: 50, verification: 'family_understanding' }],
    insured: 'unknown', dispute: 'possible', verification: 'family_understanding',
    occupants: 'Aunt Lakshmi',
  },
}

const profile = {
  tenant_id: TENANT,
  policies: [{ id: 'p1', type: 'life', member_id: 'm-org', beneficiary_member_id: 'm-adult', coverage_amount_minor: 5_000_000 }],
}

const stores: Record<string, Record<string, unknown>[]> = {
  legacy_documents: [willForOrg, orgOnlyDoc] as unknown as Record<string, unknown>[],
  legacy_contacts: [
    { id: 'c-sol', tenant_id: TENANT, name: 'Solicitor Sam', kind: 'solicitor', relationship: 'solicitor', email: 's@x.test' },
    { id: 'c-aunt', tenant_id: TENANT, name: 'Aunt Lakshmi', kind: 'family', relationship: 'aunt' },
  ],
  family_assets: [property] as unknown as Record<string, unknown>[],
  family_financial_profile: [profile],
}

const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([k, v]) => doc[k] === v)

const db = {
  collection: (name: string) => ({
    find: (filter: Record<string, unknown> = {}) => ({
      toArray: async () => (stores[name] ?? []).filter((d) => matches(d, filter)),
    }),
    findOne: async (filter: Record<string, unknown> = {}) =>
      name === 'family_groups' ? family : (stores[name] ?? []).find((d) => matches(d, filter)) ?? null,
  }),
} as never

describe('buildLegacyGraph', () => {
  it('builds members, documents, contacts, assets and policies with typed edges', async () => {
    const g = await buildLegacyGraph(db, TENANT, ORG_VIEWER)
    const kinds = g.nodes.map((n) => n.kind).sort()
    expect(kinds).toEqual(expect.arrayContaining(['member', 'contact', 'document', 'asset', 'policy']))
    // no money anywhere in the graph
    expect(JSON.stringify(g)).not.toContain('value_minor')
    expect(JSON.stringify(g)).not.toContain('coverage_amount')

    const names = (kind: string) => g.edges.filter((e) => e.kind === kind)
    // will → subject + roles + covered asset + vault-less
    expect(names('subject_of').some((e) => e.from === 'document:d-will' && e.to === 'member:m-org')).toBe(true)
    expect(names('names_as')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'document:d-will', to: 'member:m-adult', label: 'executor', verification: 'user_declared' }),
        expect.objectContaining({ from: 'document:d-will', to: 'contact:c-sol', label: 'trustee', verification: 'document_linked' }),
        expect.objectContaining({ label: 'beneficiary', to: 'member:m-adult' }),
      ]),
    )
    expect(names('covers')).toEqual([expect.objectContaining({ from: 'document:d-will', to: 'asset:a-home' })])
    expect(names('owns')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'member:m-org', to: 'asset:a-home', label: 'recorded · 50%', verification: 'document_linked' }),
        expect.objectContaining({ from: 'contact:c-aunt', to: 'asset:a-home', label: 'claimed', verification: 'family_understanding' }),
      ]),
    )
    const asset = g.nodes.find((n) => n.id === 'asset:a-home')
    expect(asset?.sublabel).toContain('occupants: Aunt Lakshmi')
  })

  it('omits organizer-visibility documents for a non-organizer viewer', async () => {
    const g = await buildLegacyGraph(db, TENANT, ADULT_VIEWER)
    expect(g.nodes.some((n) => n.id === 'document:d-secret')).toBe(false)
    expect(g.nodes.some((n) => n.id === 'document:d-will')).toBe(true)
    const org = await buildLegacyGraph(db, TENANT, ORG_VIEWER)
    expect(org.nodes.some((n) => n.id === 'document:d-secret')).toBe(true)
  })

  it('youth mode returns members and document existence only', async () => {
    const g = await buildLegacyGraph(db, TENANT, YOUTH_VIEWER)
    expect(g.nodes.every((n) => n.kind === 'member' || n.kind === 'document')).toBe(true)
    expect(g.edges).toHaveLength(0)
    expect(g.nodes.some((n) => n.id === 'asset:a-home')).toBe(false)
    expect(JSON.stringify(g)).not.toContain('executor')
    expect(JSON.stringify(g)).not.toContain('Solicitor Sam')
  })

  it('missing collections yield an empty-but-valid graph', async () => {
    const emptyDb = { collection: () => ({ find: () => ({ toArray: async () => [] }), findOne: async () => null }) } as never
    const g = await buildLegacyGraph(emptyDb, TENANT, ORG_VIEWER)
    expect(g).toEqual({ nodes: [], edges: [] })
  })
})

describe('renderLegacyGraphForAssistant', () => {
  it('renders one labelled line per document and property, under 1,200 chars', async () => {
    const g = await buildLegacyGraph(db, TENANT, ORG_VIEWER)
    const text = renderLegacyGraphForAssistant(g)
    expect(text.length).toBeLessThanOrEqual(1200)
    expect(text).toContain('will for Organizer (England & Wales')
    expect(text).toContain('executor: Adult [user-declared]')
    expect(text).toContain('trustee: Solicitor Sam [document-linked]')
    expect(text).toContain('covers: Ancestral home')
    expect(text).toContain('Ancestral home, Telangana IN')
    expect(text).toContain('Organizer recorded · 50% [document-linked]')
    expect(text).toContain('Aunt Lakshmi claimed [family understanding]')
    expect(text).toContain('dispute possible')
    // no amounts
    expect(text).not.toContain('£')
  })
})
