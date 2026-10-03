/**
 * PRD-137 §2 — buildEstateSignal: the enriched family.estate signal
 * merging vault doc_types, the roster, the legacy register, property
 * legacy metadata and profile policies. Counts are family-declared
 * record-keeping — missing collections mean zeros, never a throw.
 */
import { describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import { buildEstateSignal } from '../estate-signal.js'

const TENANT = 'tenant-signal-1'

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => doc[k] === v)
}

function makeDb(stores: Record<string, Record<string, unknown>[]>): Db {
  return {
    collection: (name: string) => {
      const store = stores[name]
      if (!store) throw new Error(`no collection ${name}`)
      return {
        findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => matches(d, filter)) ?? null,
        find: (filter: Record<string, unknown> = {}) => ({
          toArray: async () => store.filter((d) => matches(d, filter)),
        }),
      }
    },
  } as unknown as Db
}

const FAMILY = {
  tenant_id: TENANT,
  members: [
    { id: 'm-adult-a', user_id: 'u-a', name: 'Adult A', role: 'organizer', status: 'active', joined_at: '2015-01-01T00:00:00Z' },
    { id: 'm-adult-b', user_id: 'u-b', name: 'Adult B', role: 'adult', status: 'active', joined_at: '2015-01-01T00:00:00Z' },
    { id: 'm-kid-1', user_id: 'u-k1', name: 'Kid One', role: 'child', status: 'active', joined_at: '2022-06-01T00:00:00Z' },
    { id: 'm-kid-2', user_id: 'u-k2', name: 'Kid Two', role: 'child', status: 'active', joined_at: '2018-01-01T00:00:00Z' },
    { id: 'm-ex', user_id: 'u-ex', name: 'Removed', role: 'adult', status: 'removed', joined_at: '2015-01-01T00:00:00Z' },
  ],
}

const WILL = {
  id: 'leg-will-1',
  tenant_id: TENANT,
  type: 'will',
  subject_member_id: 'm-adult-a',
  jurisdiction: 'England & Wales',
  signed_on: '2019-01-15',
  last_reviewed_on: '2019-01-15',
  roles: [
    { role: 'executor', member_id: 'm-ex', verification: 'unverified' },
    { role: 'beneficiary', member_id: 'm-adult-b', verification: 'user_declared' },
  ],
  covers_asset_ids: [],
  verification: 'user_declared',
  visibility: 'adults',
}

const PROPERTY = {
  id: 'asset-1',
  tenant_id: TENANT,
  kind: 'property',
  name: 'Grandmother flat',
  value_minor: 10000000,
  legacy: {
    ownership_basis: 'unknown',
    jurisdiction: 'England & Wales',
    recorded_owners: [],
    claimed_owners: [],
    insured: 'unknown',
    dispute: 'none',
    verification: 'family_understanding',
  },
}

const PROFILE = {
  tenant_id: TENANT,
  policies: [
    { member_id: 'm-adult-a', type: 'life', provider: 'X', beneficiary_member_id: 'm-kid-1' },
  ],
}

describe('buildEstateSignal', () => {
  it('counts the fixture family correctly', async () => {
    const db = makeDb({
      family_groups: [FAMILY],
      legacy_documents: [WILL],
      family_assets: [PROPERTY],
      family_financial_profile: [PROFILE],
      documents: [],
      legacy_contacts: [],
    })
    const s = await buildEstateSignal(db, TENANT)

    expect(s.has_legacy_records).toBe(1)
    expect(s.has_will).toBe(1) // legacy will counts toward the household boolean
    expect(s.has_power_of_attorney).toBe(0)
    expect(s.estate_doc_count).toBe(0) // no vault doc_types

    expect(s.adults_total).toBe(2)
    expect(s.adults_with_will).toBe(1)
    expect(s.adults_with_poa).toBe(0)
    expect(s.adults_with_directive).toBe(0)

    // Reviewed 2019 — >36 months ago, and child m-kid-1 joined 2022.
    expect(s.wills_total).toBe(1)
    expect(s.wills_stale).toBe(1)
    // Executor is a removed roster member whose role is unverified.
    expect(s.wills_with_dead_or_missing_executor).toBe(1)

    expect(s.minors_total).toBe(2)
    // Will has a beneficiary role but no guardian role; no nomination doc.
    expect(s.minors_with_guardian_nomination).toBe(0)

    expect(s.properties_total).toBe(1)
    expect(s.properties_without_title_evidence).toBe(1)
    expect(s.properties_ownership_unknown).toBe(1)
    expect(s.properties_foreign_without_contact).toBe(0) // same jurisdiction as the will
    expect(s.properties_disputed).toBe(0)
    expect(s.properties_uninsured_or_unknown).toBe(1)

    expect(s.documents_without_original_location).toBe(1) // will has none
    expect(s.original_location_total).toBe(1)
    expect(s.assets_unreferenced_by_any_will).toBe(1) // covers_asset_ids is empty
    expect(s.beneficiary_conflicts).toBe(1) // will: adult B; policy: kid 1
    expect(s.businesses_without_successor).toBe(0)
  })

  it('guardian nomination covers the minor it is about', async () => {
    const db = makeDb({
      family_groups: [FAMILY],
      legacy_documents: [
        { ...WILL, last_reviewed_on: '2099-01-01' },
        {
          id: 'leg-guard-1',
          tenant_id: TENANT,
          type: 'guardianship_nomination',
          subject_member_id: 'm-kid-1',
          jurisdiction: 'England & Wales',
          roles: [{ role: 'guardian', contact_id: 'c-aunt', verification: 'user_declared' }],
          covers_asset_ids: [],
          verification: 'user_declared',
          visibility: 'adults',
        },
      ],
      legacy_contacts: [{ id: 'c-aunt', tenant_id: TENANT, name: 'Aunt', relationship: 'sister', kind: 'family' }],
      family_assets: [],
      family_financial_profile: [PROFILE],
      documents: [],
    })
    const s = await buildEstateSignal(db, TENANT)
    expect(s.minors_with_guardian_nomination).toBe(1)
    expect(s.wills_stale).toBe(0) // reviewed in the future — not stale
  })

  it('vault doc_types still drive the household booleans', async () => {
    const db = makeDb({
      family_groups: [FAMILY],
      legacy_documents: [],
      family_assets: [],
      family_financial_profile: [],
      legacy_contacts: [],
      documents: [
        { id: 'd1', tenant_id: TENANT, category: 'estate_vault', doc_type: 'will' },
        { id: 'd2', tenant_id: TENANT, category: 'estate_vault', doc_type: 'power_of_attorney' },
        { id: 'd3', tenant_id: TENANT, category: 'general', doc_type: 'will' },
      ],
    })
    const s = await buildEstateSignal(db, TENANT)
    expect(s.has_will).toBe(1)
    expect(s.has_power_of_attorney).toBe(1)
    expect(s.estate_doc_count).toBe(2)
    expect(s.has_legacy_records).toBe(0)
  })

  it('foreign property without a local contact is counted', async () => {
    const db = makeDb({
      family_groups: [FAMILY],
      legacy_documents: [{ ...WILL, last_reviewed_on: '2099-01-01' }],
      family_assets: [
        { ...PROPERTY, legacy: { ...PROPERTY.legacy, jurisdiction: 'Telangana, IN' } },
      ],
      family_financial_profile: [],
      legacy_contacts: [],
      documents: [],
    })
    const s = await buildEstateSignal(db, TENANT)
    expect(s.properties_foreign_without_contact).toBe(1)
  })

  it('empty family — all zeros and has_legacy_records 0', async () => {
    const db = makeDb({
      family_groups: [{ tenant_id: TENANT, members: [] }],
      legacy_documents: [],
      family_assets: [],
      family_financial_profile: [],
      legacy_contacts: [],
      documents: [],
    })
    const s = await buildEstateSignal(db, TENANT)
    expect(s).toEqual({
      has_will: 0,
      has_power_of_attorney: 0,
      estate_doc_count: 0,
      adults_total: 0,
      adults_with_will: 0,
      adults_with_poa: 0,
      adults_with_directive: 0,
      wills_stale: 0,
      wills_with_dead_or_missing_executor: 0,
      minors_total: 0,
      minors_with_guardian_nomination: 0,
      properties_total: 0,
      properties_without_title_evidence: 0,
      properties_ownership_unknown: 0,
      properties_foreign_without_contact: 0,
      properties_disputed: 0,
      properties_uninsured_or_unknown: 0,
      documents_without_original_location: 0,
      assets_unreferenced_by_any_will: 0,
      beneficiary_conflicts: 0,
      businesses_without_successor: 0,
      has_legacy_records: 0,
      wills_total: 0,
      original_location_total: 0,
    })
  })

  it('missing collections and methods — zeros, never a throw', async () => {
    const db = {
      collection: () => ({ find: () => undefined, findOne: async () => null }),
    } as unknown as Db
    const s = await buildEstateSignal(db, TENANT)
    expect(s.has_legacy_records).toBe(0)
    expect(s.adults_total).toBe(0)
    expect(s.has_will).toBe(0)
  })
})
