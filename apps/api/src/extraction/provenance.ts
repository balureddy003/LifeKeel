/**
 * Where a profile value came from (PRD-143 item 4). One values-free row per
 * profile path or policy: the document, who confirmed it, when, how sure the
 * grounding was and which extractor and schema produced it. It lives beside
 * the profile, not inside it, so a later wizard save that rewrites the
 * profile document does not lose it.
 */
import type { Db } from 'mongodb'
import type { ExtractionCandidates } from './pipeline.js'

const COLLECTION = 'profile_provenance'

export interface ProvenanceRow {
  tenant_id: string
  /** A profile path ("household.life_cover_minor") or "policy:<type>:<provider>:<number>". */
  ref: string
  document_id: string
  confirmed_by: string
  confirmed_at: Date
  /** Null when the value was typed or edited by the person rather than read. */
  confidence: number | null
  extractor: string
  schema_version: string
}

export const policyRef = (type: string, provider: string, policyNumber?: string) =>
  `policy:${type}:${provider.trim().toLowerCase()}:${(policyNumber ?? '').trim().toLowerCase()}`

export async function saveProvenance(
  db: Db,
  tenantId: string,
  rows: Omit<ProvenanceRow, 'tenant_id'>[],
): Promise<void> {
  for (const r of rows) {
    await db
      .collection(COLLECTION)
      .replaceOne(
        { tenant_id: tenantId, ref: r.ref },
        { tenant_id: tenantId, ...r },
        { upsert: true },
      )
  }
}

export const extractorLabel = (c: ExtractionCandidates | null) =>
  c ? `${c.extractor.kind}:${c.extractor.model}` : 'unknown'
