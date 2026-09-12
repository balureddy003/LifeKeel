export interface CorrelationEvidence {
  tenant_id: string
  evidence_type: string
  evidence_id: string
  data: Record<string, unknown>
  observed_at: Date
}

export interface CorrelationWindow {
  complete: boolean
  distinct_evidence_types: number
  evidence_ids: string[]
  data: Record<string, unknown>
}

export class CorrelationBuffer {
  private readonly entries = new Map<string, CorrelationEvidence[]>()

  add(evidence: CorrelationEvidence): void {
    const list = this.entries.get(evidence.tenant_id) ?? []
    list.push(evidence)
    this.entries.set(evidence.tenant_id, list)
  }

  aggregate(
    tenantId: string,
    evidenceTypes: string[],
    windowHours: number,
    minEvidenceCount: number,
    requireAll: boolean,
    asOf = new Date(),
  ): CorrelationWindow {
    const since = asOf.getTime() - windowHours * 3_600_000
    const matching = (this.entries.get(tenantId) ?? [])
      // ignore entries without a valid observed_at — they cannot be time-ordered
      .filter(entry => entry.observed_at instanceof Date && entry.observed_at.getTime() >= since && evidenceTypes.includes(entry.evidence_type))
      .sort((a, b) => (a.observed_at instanceof Date ? a.observed_at.getTime() : 0) - (b.observed_at instanceof Date ? b.observed_at.getTime() : 0))
    const distinct = new Set(matching.map(entry => entry.evidence_type))
    const complete = matching.length >= minEvidenceCount
      && (requireAll ? evidenceTypes.every(type => distinct.has(type)) : distinct.size > 0)
    const data = Object.assign({}, ...matching.map(entry => entry.data))

    this.entries.set(tenantId, (this.entries.get(tenantId) ?? []).filter(entry => entry.observed_at instanceof Date && entry.observed_at.getTime() >= since))
    return {
      complete,
      distinct_evidence_types: distinct.size,
      evidence_ids: matching.map(entry => entry.evidence_id),
      data,
    }
  }
}
