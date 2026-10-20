/**
 * PRD-208 claims register. definitions/trust-claims.yaml lists every statement
 * the public trust page may make; the `trust_evidence` collection holds who
 * owns each one and when it was last verified and must be renewed. A claim is
 * public only while all of that is current, so a lapsed claim disappears
 * rather than lingering ("removed, not softened").
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { Db } from 'mongodb'
import { repoRoot } from '@lifekeel/platform'

export interface Claim {
  id: string
  statement: string
  publishable: boolean
  reason?: string
  evidence?: { kind: 'page' | 'check' | 'commitment'; href?: string; how: string }
}

export interface EvidenceRecord {
  claim_id: string
  owner: string
  verified_at: Date
  renew_by: Date
}

export type ClaimState = 'published' | 'stale' | 'needs_owner' | 'not_evidenced'

export interface ClaimStatus extends Claim {
  state: ClaimState
  owner: string | null
  verified_at: string | null
  renew_by: string | null
}

export function parseClaims(raw: unknown): Claim[] {
  const list = (raw as { claims?: unknown })?.claims
  if (!Array.isArray(list)) throw new Error('trust-claims.yaml: claims must be a list')
  const seen = new Set<string>()
  return list.map((c: Claim) => {
    if (!c?.id || !c.statement || typeof c.publishable !== 'boolean')
      throw new Error(`trust-claims.yaml: invalid claim ${c?.id ?? '(no id)'}`)
    if (seen.has(c.id)) throw new Error(`trust-claims.yaml: duplicate claim ${c.id}`)
    seen.add(c.id)
    if (c.publishable && !c.evidence?.how)
      throw new Error(`trust-claims.yaml: ${c.id} is publishable but names no evidence`)
    if (!c.publishable && !c.reason)
      throw new Error(`trust-claims.yaml: ${c.id} is unpublished but gives no reason`)
    return c
  })
}

let cached: Claim[] | null = null
export function loadClaims(): Claim[] {
  cached ??= parseClaims(
    loadYaml(readFileSync(join(repoRoot(), 'definitions', 'trust-claims.yaml'), 'utf8')),
  )
  return cached
}

export function evaluateClaims(
  claims: Claim[],
  records: EvidenceRecord[],
  now: Date = new Date(),
): ClaimStatus[] {
  const byId = new Map(records.map((r) => [r.claim_id, r]))
  return claims.map((c) => {
    const r = byId.get(c.id)
    const base = {
      ...c,
      owner: r?.owner ?? null,
      verified_at: r?.verified_at.toISOString() ?? null,
      renew_by: r?.renew_by.toISOString() ?? null,
    }
    if (!c.publishable) return { ...base, state: 'not_evidenced' as const }
    if (!r || !r.owner) return { ...base, state: 'needs_owner' as const }
    if (r.renew_by.getTime() <= now.getTime()) return { ...base, state: 'stale' as const }
    return { ...base, state: 'published' as const }
  })
}

export async function claimStatuses(db: Db, now = new Date()): Promise<ClaimStatus[]> {
  const records = await db
    .collection<EvidenceRecord>('trust_evidence')
    .find({}, { projection: { _id: 0 } })
    .toArray()
  return evaluateClaims(loadClaims(), records, now)
}
