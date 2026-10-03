/**
 * PRD-137 §2: the enriched `family.estate` signal.
 *
 * One shared builder behind every emission site (vault mutations, the
 * profile re-evaluation, legacy writes, the daily sweep) so the detector
 * and the readiness `estate` component always see the same numbers. The
 * original three vault fields are kept — vault doc_types remain
 * load-bearing — and the legacy register fields layer on top.
 *
 * Everything here is family-declared information: a count of what Oak
 * has on file, never a judgement about legal validity or ownership.
 * Every collection read tolerates fake dbs and absent collections —
 * "not entered" yields zeros, it never throws and never reads as a
 * negative fact (an undated will is "unknown", not "stale").
 */

import type { Db } from 'mongodb'
import { getTenantCollection } from '@agentoak/platform'
import { ageFromDob } from '../lib/family-permissions.js'
import { ESTATE_VAULT_CATEGORY } from '../routes/documents.js'
import type { LegacyDocument, LegacyContact } from '../routes/family-legacy.js'
import type { PropertyLegacy } from '../routes/family-legacy.js'
import type { FamilyMemberDoc } from '../routes/family-group.js'

export interface EstateSignalData extends Record<string, unknown> {
  has_will: number
  has_power_of_attorney: number
  estate_doc_count: number
  adults_total: number
  adults_with_will: number
  adults_with_poa: number
  adults_with_directive: number
  wills_stale: number
  wills_with_dead_or_missing_executor: number
  minors_total: number
  minors_with_guardian_nomination: number
  properties_total: number
  properties_without_title_evidence: number
  properties_ownership_unknown: number
  properties_foreign_without_contact: number
  properties_disputed: number
  properties_uninsured_or_unknown: number
  documents_without_original_location: number
  assets_unreferenced_by_any_will: number
  beneficiary_conflicts: number
  businesses_without_successor: number
  /** Total wills on file — denominator for the readiness score's
   *  per-will checks (executor resolvable, reviewed recently). */
  wills_total: number
  /** Will / PoA / trust-deed docs — the set original_location applies to. */
  original_location_total: number
  /** 1 when the family has recorded anything in the legacy register
   *  (a legacy document, or legacy metadata on a property asset). */
  has_legacy_records: number
}

const ADULT_ROLES = new Set(['organizer', 'parent', 'adult'])
const MONTHS_WILL_STALE = 36

type AnyDoc = Record<string, unknown>

async function readAll(db: Db, tenantId: string, name: string): Promise<AnyDoc[]> {
  try {
    return (await getTenantCollection<AnyDoc>(db, name, tenantId).find({}).toArray()) as AnyDoc[]
  } catch {
    return []
  }
}

async function readOne(db: Db, tenantId: string, name: string): Promise<AnyDoc | null> {
  try {
    return (await getTenantCollection<AnyDoc>(db, name, tenantId).findOne({})) as AnyDoc | null
  } catch {
    return null
  }
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function monthsBetween(earlier: Date, later: Date): number {
  return (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth())
}

export async function buildEstateSignal(db: Db, tenantId: string): Promise<EstateSignalData> {
  const [vaultDocs, groupDoc, legacyDocs, contacts, assets, profile] = await Promise.all([
    readAll(db, tenantId, 'documents').then((docs) =>
      docs.filter((d) => d['category'] === ESTATE_VAULT_CATEGORY),
    ),
    readOne(db, tenantId, 'family_groups'),
    readAll(db, tenantId, 'legacy_documents'),
    readAll(db, tenantId, 'legacy_contacts'),
    readAll(db, tenantId, 'family_assets'),
    readOne(db, tenantId, 'family_financial_profile'),
  ])

  const docTypes = new Set(
    vaultDocs.map((d) => d['doc_type']).filter((t): t is string => typeof t === 'string'),
  )
  const vaultHasWill = docTypes.has('will')
  const vaultHasPoa = docTypes.has('power_of_attorney')

  // ── Roster ────────────────────────────────────────────────────────────
  const members = (groupDoc?.['members'] as FamilyMemberDoc[] | undefined) ?? []
  const ageOf = (m: FamilyMemberDoc) => (m.date_of_birth ? ageFromDob(m.date_of_birth) : null)
  const adults = members.filter((m) => ADULT_ROLES.has(m.role) && m.status === 'active')
  const minors = members.filter((m) => {
    const age = ageOf(m)
    return m.role === 'child' || (age !== null && age < 18)
  })
  const activeMemberIds = new Set(members.filter((m) => m.status === 'active').map((m) => m.id))

  // ── Legacy documents ──────────────────────────────────────────────────
  const docs = legacyDocs as unknown as LegacyDocument[]
  const contactIds = new Set((contacts as unknown as LegacyContact[]).map((c) => c.id))
  const adultIds = new Set(adults.map((m) => m.id))
  const countSubjects = (type: string) =>
    new Set(docs.filter((d) => d.type === type && adultIds.has(d.subject_member_id)).map((d) => d.subject_member_id)).size
  const adultsWithWill = countSubjects('will')
  const adultsWithPoa = countSubjects('power_of_attorney')
  const adultsWithDirective = countSubjects('advance_directive')

  const wills = docs.filter((d) => d.type === 'will')
  const childJoinDates = minors.map((m) => parseDate(m.joined_at)).filter((d): d is Date => d !== null)

  const properties = (assets as AnyDoc[]).filter(
    (a) => a['kind'] === 'property' && a['legacy'] !== undefined && a['legacy'] !== null,
  )
  const propertyLegacies = properties.map((a) => a['legacy'] as PropertyLegacy)
  const propertyAcquireDates = propertyLegacies.map((l) => parseDate(l.acquired_on)).filter((d): d is Date => d !== null)
  // A new civil record (marriage, birth, death certificate…) recorded after
  // the will was reviewed is the same "life moved on" trigger as a new
  // child or property — signed_on is the declared date, created_at the
  // fallback for when it entered the register.
  const civilDates = docs
    .filter((d) => d.type === 'civil_certificate')
    .map((d) => parseDate(d.signed_on) ?? parseDate((d as AnyDoc)['created_at']))
    .filter((d): d is Date => d !== null)

  const now = new Date()
  let willsStale = 0
  let willsDeadOrMissingExecutor = 0
  for (const will of wills) {
    const reviewDate = parseDate(will.last_reviewed_on) ?? parseDate(will.signed_on)
    if (reviewDate !== null) {
      const stale =
        monthsBetween(reviewDate, now) > MONTHS_WILL_STALE ||
        [...childJoinDates, ...propertyAcquireDates, ...civilDates].some((d) => d > reviewDate)
      if (stale) willsStale++
    }
    const hasBrokenExecutor = (will.roles ?? []).some((r) => {
      if (r.role !== 'executor') return false
      if (r.verification === 'unverified') return true
      const memberOk = r.member_id !== undefined && activeMemberIds.has(r.member_id)
      const contactOk = r.contact_id !== undefined && contactIds.has(r.contact_id)
      return !memberOk && !contactOk
    })
    if (hasBrokenExecutor) willsDeadOrMissingExecutor++
  }

  // ── Guardianship ──────────────────────────────────────────────────────
  const minorIds = new Set(minors.map((m) => m.id))
  const guardianshipSubjects = new Set(
    docs.filter((d) => d.type === 'guardianship_nomination').map((d) => d.subject_member_id),
  )
  const minorsWithGuardian = minors.filter((minor) => {
    if (guardianshipSubjects.has(minor.id)) return true
    return wills.some((will) => {
      const mentionsMinor =
        will.subject_member_id === minor.id ||
        (will.roles ?? []).some((r) => r.role === 'beneficiary' && r.member_id === minor.id)
      return mentionsMinor && (will.roles ?? []).some((r) => r.role === 'guardian')
    })
  }).length

  // ── Property checks ───────────────────────────────────────────────────
  const normalizeJurisdiction = (j: unknown) => (typeof j === 'string' ? j.trim().toLowerCase() : '')
  const willJurisdictions = new Map<string, number>()
  for (const will of wills) {
    const j = normalizeJurisdiction(will.jurisdiction)
    if (j) willJurisdictions.set(j, (willJurisdictions.get(j) ?? 0) + 1)
  }
  let majorityJurisdiction: string | null = null
  for (const [j, n] of willJurisdictions) {
    if (majorityJurisdiction === null || n > willJurisdictions.get(majorityJurisdiction)!) {
      majorityJurisdiction = j
    }
  }

  let withoutTitleEvidence = 0
  let ownershipUnknown = 0
  let foreignWithoutContact = 0
  let disputed = 0
  let uninsuredOrUnknown = 0
  for (const legacy of propertyLegacies) {
    if (!legacy.title_document_id && !legacy.title_reference) withoutTitleEvidence++
    if (legacy.ownership_basis === 'unknown' || (legacy.recorded_owners ?? []).length === 0) ownershipUnknown++
    if (
      majorityJurisdiction !== null &&
      normalizeJurisdiction(legacy.jurisdiction) !== majorityJurisdiction &&
      !legacy.professional_contact_id
    ) {
      foreignWithoutContact++
    }
    if (legacy.dispute === 'possible' || legacy.dispute === 'active') disputed++
    if (legacy.insured !== 'yes') uninsuredOrUnknown++
  }

  // ── Cross-document checks ─────────────────────────────────────────────
  const documentsWithoutOriginalLocation = docs.filter(
    (d) => ['will', 'power_of_attorney', 'trust_deed'].includes(d.type) && !d.original_location,
  ).length

  const coveredAssetIds = new Set(wills.flatMap((w) => w.covers_asset_ids ?? []))
  const assetsUnreferenced =
    wills.length === 0
      ? 0
      : properties.filter((a) => !coveredAssetIds.has(String(a['id'] ?? a['_id']))).length

  const policies = (profile?.['policies'] as AnyDoc[] | undefined) ?? []
  let beneficiaryConflicts = 0
  const willSubjects = new Set(wills.map((w) => w.subject_member_id))
  for (const subject of willSubjects) {
    const subjectWills = wills.filter((w) => w.subject_member_id === subject)
    const willBeneficiaries = new Set(
      subjectWills
        .flatMap((w) => w.roles ?? [])
        .filter((r) => r.role === 'beneficiary' && r.member_id !== undefined)
        .map((r) => r.member_id!),
    )
    const policyBeneficiaries = new Set(
      policies
        .filter((p) => p['member_id'] === subject && typeof p['beneficiary_member_id'] === 'string')
        .map((p) => p['beneficiary_member_id'] as string),
    )
    if (willBeneficiaries.size === 0 || policyBeneficiaries.size === 0) continue
    const differ =
      willBeneficiaries.size !== policyBeneficiaries.size ||
      [...willBeneficiaries].some((id) => !policyBeneficiaries.has(id))
    if (differ) beneficiaryConflicts++
  }

  const hasLegacyRecords = docs.length > 0 || propertyLegacies.length > 0 ? 1 : 0

  return {
    has_will: Number(vaultHasWill || adultsWithWill > 0),
    has_power_of_attorney: Number(vaultHasPoa || adultsWithPoa > 0),
    estate_doc_count: docTypes.size,
    adults_total: adults.length,
    adults_with_will: adultsWithWill,
    adults_with_poa: adultsWithPoa,
    adults_with_directive: adultsWithDirective,
    wills_stale: willsStale,
    wills_with_dead_or_missing_executor: willsDeadOrMissingExecutor,
    minors_total: minors.length,
    minors_with_guardian_nomination: minorsWithGuardian,
    properties_total: propertyLegacies.length,
    properties_without_title_evidence: withoutTitleEvidence,
    properties_ownership_unknown: ownershipUnknown,
    properties_foreign_without_contact: foreignWithoutContact,
    properties_disputed: disputed,
    properties_uninsured_or_unknown: uninsuredOrUnknown,
    documents_without_original_location: documentsWithoutOriginalLocation,
    assets_unreferenced_by_any_will: assetsUnreferenced,
    beneficiary_conflicts: beneficiaryConflicts,
    businesses_without_successor: 0,
    wills_total: wills.length,
    original_location_total: docs.filter((d) =>
      ['will', 'power_of_attorney', 'trust_deed'].includes(d.type),
    ).length,
    has_legacy_records: hasLegacyRecords,
  }
}
