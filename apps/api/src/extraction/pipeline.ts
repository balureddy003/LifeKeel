/**
 * Extraction candidates and review (PRD-143). Extraction proposes; nothing
 * reaches the financial profile until a person confirms it.
 *
 * Each extracted field is stored as a candidate with its grounding in the
 * document text (span and snippet), a confidence computed from that grounding,
 * the extractor and schema version, and a status. The user confirms, edits or
 * rejects each one; only confirmed or edited values are ever used downstream.
 * A decision that does not validate rejects the whole review, so nothing is
 * partly applied.
 *
 * Audit events carry counts and durations only: never a value, a snippet or
 * document text.
 */
import type { Db } from 'mongodb'
import { getAuditLogger, type AuditAction } from '../audit/audit-log.js'
import { FIELD_KEYS, SCHEMA_VERSION, SPEC_BY_KEY, normaliseValue } from './schema.js'
import {
  REVIEW_THRESHOLD,
  classificationConfidence,
  groundField,
  needsTypeConfirmation,
  type GroundingKind,
} from './grounding.js'

export type CandidateStatus = 'proposed' | 'confirmed' | 'edited' | 'rejected'

export interface CandidateField {
  key: string
  value: string
  confidence: number
  grounding: GroundingKind
  span: { start: number; end: number } | null
  snippet: string | null
  /** Below the review threshold: the user must check it against the source. */
  needs_review: boolean
  status: CandidateStatus
  edited_value?: string
  decided_by?: string
  decided_at?: Date
}

export interface ExtractionCandidates {
  tenant_id: string
  document_id: string
  schema_version: string
  extractor: { kind: 'local' | 'hosted_vision'; model: string }
  classification: { category: string; confidence: number; needs_confirmation: boolean }
  fields: CandidateField[]
  /** Values the model returned that failed validation and were dropped. */
  dropped: number
  created_at: Date
  updated_at: Date
}

const COLLECTION = 'extraction_candidates'

export function buildCandidates(input: {
  tenantId: string
  documentId: string
  category: string
  rawFields: Record<string, unknown>
  /** The document's own text, or null when it was read from an image. */
  text: string | null
  extractor: ExtractionCandidates['extractor']
  now?: Date
}): ExtractionCandidates {
  const now = input.now ?? new Date()
  const fields: CandidateField[] = []
  let dropped = 0
  for (const key of FIELD_KEYS) {
    const raw = input.rawFields[key]
    if (raw === undefined || raw === null || raw === '') continue
    const spec = SPEC_BY_KEY[key]!
    const value = normaliseValue(spec, raw)
    if (value === null || !(spec.categories as readonly string[]).includes(input.category)) {
      dropped++
      continue
    }
    const g = groundField(key, value, input.text)
    fields.push({
      key,
      value,
      confidence: g.confidence,
      grounding: g.grounding,
      span: g.span,
      snippet: g.snippet,
      needs_review: g.confidence < REVIEW_THRESHOLD,
      status: 'proposed',
    })
  }
  const confidence = classificationConfidence(input.category, input.text)
  return {
    tenant_id: input.tenantId,
    document_id: input.documentId,
    schema_version: SCHEMA_VERSION,
    extractor: input.extractor,
    classification: {
      category: input.category,
      confidence,
      needs_confirmation: needsTypeConfirmation(input.category, confidence),
    },
    fields,
    dropped,
    created_at: now,
    updated_at: now,
  }
}

/** Replaces any earlier candidates for the document (a reprocess starts review over). */
export async function saveCandidates(db: Db, c: ExtractionCandidates): Promise<void> {
  await db
    .collection<ExtractionCandidates>(COLLECTION)
    .replaceOne({ tenant_id: c.tenant_id, document_id: c.document_id }, c, { upsert: true })
}

export async function loadCandidates(
  db: Db,
  tenantId: string,
  documentId: string,
): Promise<ExtractionCandidates | null> {
  const row = (await db
    .collection(COLLECTION)
    .findOne(
      { tenant_id: tenantId, document_id: documentId },
      { projection: { _id: 0 } },
    )) as ExtractionCandidates | null
  return row
}

export interface ReviewDecision {
  key: string
  action: 'confirm' | 'edit' | 'reject'
  value?: string
}

export type ReviewResult =
  | { ok: true; candidates: ExtractionCandidates }
  | { ok: false; errors: { key: string; reason: string }[] }

/**
 * Apply a review to candidates. All or nothing: any invalid decision rejects
 * the whole batch and changes nothing.
 */
export function applyReview(
  c: ExtractionCandidates,
  decisions: ReviewDecision[],
  userId: string,
  now: Date = new Date(),
): ReviewResult {
  const errors: { key: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const d of decisions) {
    const field = c.fields.find((f) => f.key === d.key)
    if (!field) errors.push({ key: d.key, reason: 'unknown_field' })
    else if (seen.has(d.key)) errors.push({ key: d.key, reason: 'duplicate_decision' })
    else if (d.action === 'edit') {
      if (normaliseValue(SPEC_BY_KEY[d.key]!, d.value) === null)
        errors.push({ key: d.key, reason: 'invalid_value' })
    } else if (d.action !== 'confirm' && d.action !== 'reject') {
      errors.push({ key: d.key, reason: 'invalid_action' })
    }
    seen.add(d.key)
  }
  if (errors.length > 0) return { ok: false, errors }

  const fields = c.fields.map((f) => {
    const d = decisions.find((x) => x.key === f.key)
    if (!d) return f
    const base = { ...f, decided_by: userId, decided_at: now }
    if (d.action === 'confirm') return { ...base, status: 'confirmed' as const }
    if (d.action === 'reject') return { ...base, status: 'rejected' as const }
    return {
      ...base,
      status: 'edited' as const,
      edited_value: normaliseValue(SPEC_BY_KEY[f.key]!, d.value)!,
    }
  })
  return { ok: true, candidates: { ...c, fields, updated_at: now } }
}

/** Only what a person confirmed or edited: the sole input to profile suggestions. */
export function confirmedFields(c: ExtractionCandidates): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of c.fields) {
    if (f.status === 'confirmed') out[f.key] = f.value
    else if (f.status === 'edited' && f.edited_value !== undefined) out[f.key] = f.edited_value
  }
  return out
}

/** Keys that still need a person's eyes before they may be used. */
export const unreviewedLowConfidence = (c: ExtractionCandidates): string[] =>
  c.fields.filter((f) => f.needs_review && f.status === 'proposed').map((f) => f.key)

export interface Provenance {
  document_id: string
  confirmed_by: string
  confirmed_at: Date
  confidence: number
  extractor: string
  schema_version: string
}

// ── Audit: metadata only ────────────────────────────────────────────────────

export type ExtractionStep =
  'document.intake' | 'document.extracted' | 'document.reviewed' | 'document.committed'

export function auditStep(
  tenantId: string,
  userId: string,
  step: ExtractionStep,
  documentId: string,
  metadata: Record<string, number | string | boolean>,
): void {
  getAuditLogger()?.log({
    tenant_id: tenantId,
    user_id: userId,
    action: step as AuditAction,
    resource_type: 'document',
    resource_id: documentId,
    metadata,
    ip: '',
    user_agent: '',
    timestamp: new Date(),
  })
}
