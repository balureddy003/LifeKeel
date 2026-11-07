/**
 * Adapters read records that already live in another store, so a domain never
 * duplicates family data. Each returns plain rows; member fields carry roster
 * ids and are resolved to names by the view builder.
 */
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { RecordType } from './types.js'

export interface DomainRow {
  id: string
  record: string
  /** Roster member id of the holder, or null when not attributed. */
  holder_member_id: string | null
  /** Roster member id of the person the record covers, or null. */
  covers_member_id: string | null
  /** Display values keyed by field key. Member fields hold a roster id. */
  values: Record<string, string>
}

export interface RosterRef {
  id: string
  name: string
}

type Adapter = (
  db: Db,
  tenantId: string,
  rec: RecordType,
  roster: RosterRef[],
) => Promise<DomainRow[]>

interface PolicyLike {
  id?: string
  type: string
  provider?: string
  renewal_date?: string
  member_id?: string
  beneficiary_member_id?: string
  nomination?: { nominated_label?: string }
  contact_phone?: string
  contact_email?: string
}

const financialProfilePolicies: Adapter = async (db, tenantId, rec) => {
  const doc = await getTenantCollection<{ policies?: PolicyLike[] }>(
    db,
    'family_financial_profile',
    tenantId,
  ).findOne({})
  const allowed = rec.fields.find((f) => f.key === 'type')?.choices ?? []
  return (doc?.policies ?? [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => allowed.includes(p.type))
    .map(({ p, i }) => ({
      id: p.id ?? `policy_${i}`,
      record: rec.key,
      holder_member_id: p.member_id ?? null,
      covers_member_id: p.beneficiary_member_id ?? null,
      values: {
        type: p.type,
        provider: p.provider ?? '',
        holder: p.member_id ?? '',
        covers: p.beneficiary_member_id ?? '',
        nominated: p.nomination?.nominated_label ?? '',
        renewal_date: p.renewal_date ?? '',
        claims_contact: p.contact_phone ?? p.contact_email ?? '',
      },
    }))
}

const employerCoverFacts: Adapter = async (db, tenantId, rec, roster) => {
  type CoverDoc = {
    id: string
    member_label: string
    type: string
    name_as_printed: string
    ends_with_employment: boolean
  }
  const docs = (await getTenantCollection<CoverDoc>(db, 'employer_cover_facts', tenantId)
    .find({})
    .toArray()) as CoverDoc[]
  return docs.map((d) => {
    // The household typed a name, not an id. Match on the full name only, the
    // same rule household-obligations uses; an unmatched name stays unattributed.
    const label = d.member_label.trim().toLowerCase()
    const hits = roster.filter((m) => m.name.trim().toLowerCase() === label)
    const holder = hits.length === 1 ? hits[0]!.id : null
    return {
      id: d.id,
      record: rec.key,
      holder_member_id: holder,
      covers_member_id: holder,
      values: {
        holder: holder ?? '',
        type: d.type,
        name_as_printed: d.name_as_printed,
        ends_with_employment: d.ends_with_employment ? 'yes' : 'no',
      },
    }
  })
}

export const ADAPTERS: Record<string, Adapter> = {
  financial_profile_policies: financialProfilePolicies,
  employer_cover_facts: employerCoverFacts,
}
