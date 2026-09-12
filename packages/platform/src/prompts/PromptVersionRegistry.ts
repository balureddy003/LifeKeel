import { createHash, randomUUID } from 'node:crypto'

// Deliberately structural: platform does not depend on the MongoDB driver package.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Collection = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any }

export type PromptCallType = 'enrichment' | 'decomposition' | 'judge' | 'nlq' | 'summary'
export type PromptStatus = 'candidate' | 'a_b_test' | 'production' | 'retired'

export interface PromptEvalResult {
  run_id: string
  dataset: string
  f1: number
  precision: number
  recall: number
  judge_quality_score: number
  p95_latency_ms: number
  cost_per_call_usd: number
  ran_at: Date
}

export interface PromptVersion {
  id: string
  template_hash: string
  template: string
  parent_id: string | null
  author: string
  created_at: Date
  status: PromptStatus
  promoted_at: Date | null
  retired_at: Date | null
  eval_results: PromptEvalResult[]
  metadata: {
    skill_id?: string
    detector_id?: string
    call_type: PromptCallType
  }
}

export interface LlmSpan {
  trace_id: string
  prompt_version_id: string
  tenant_id: string
  call_type: string
  model: string
  input_tokens: number
  output_tokens: number
  latency_ms: number
  cost_usd: number
  cache_hit: boolean
  timestamp: Date
}

export class PromptVersionRegistry {
  private readonly versions: Collection
  private readonly spans: Collection

  constructor(private readonly db: Db) {
    this.versions = db.collection('prompt_versions')
    this.spans = db.collection('llm_spans')
    this.versions.createIndex?.({ id: 1 }, { unique: true }).catch(() => {})
    this.spans.createIndex?.({ tenant_id: 1, prompt_version_id: 1, timestamp: -1 }).catch(() => {})
  }

  async createCandidate(input: {
    template: string
    parent_id?: string | null
    author: string
    metadata: PromptVersion['metadata']
  }): Promise<PromptVersion> {
    const id = `${input.metadata.skill_id ?? input.metadata.detector_id ?? input.metadata.call_type}.${randomUUID()}`
    const version: PromptVersion = {
      id,
      template_hash: createHash('sha256').update(input.template).digest('hex'),
      template: input.template,
      parent_id: input.parent_id ?? null,
      author: input.author,
      created_at: new Date(),
      status: 'candidate',
      promoted_at: null,
      retired_at: null,
      eval_results: [],
      metadata: input.metadata,
    }
    await this.versions.insertOne(version)
    return version
  }

  async addEval(versionId: string, result: PromptEvalResult): Promise<void> {
    await this.versions.updateOne({ id: versionId }, { $push: { eval_results: result } })
  }

  async get(versionId: string): Promise<PromptVersion | null> {
    return this.versions.findOne({ id: versionId }) as Promise<PromptVersion | null>
  }

  async list(filter: { status?: PromptStatus; skill_id?: string; detector_id?: string } = {}): Promise<PromptVersion[]> {
    const query: Record<string, unknown> = {}
    if (filter.status) query['status'] = filter.status
    if (filter.skill_id) query['metadata.skill_id'] = filter.skill_id
    if (filter.detector_id) query['metadata.detector_id'] = filter.detector_id
    return this.versions.find(query).sort({ created_at: -1 }).toArray() as Promise<PromptVersion[]>
  }

  async startAbTest(versionId: string): Promise<void> {
    await this.versions.updateOne({ id: versionId, status: 'candidate' }, { $set: { status: 'a_b_test' } })
  }

  async promote(versionId: string): Promise<PromptVersion> {
    const candidate = await this.versions.findOne({ id: versionId }) as PromptVersion | null
    if (!candidate || candidate.status !== 'a_b_test') throw new Error('Only A/B test candidates can be promoted')
    const latest = candidate.eval_results.at(-1)
    if (!latest || latest.judge_quality_score < 0.8) throw new Error('Candidate has not passed the judge quality gate')
    const scope = promptScope(candidate)
    const production = await this.versions.findOne({ status: 'production', ...scope }) as PromptVersion | null
    const prodEval = production?.eval_results.at(-1)
    if (prodEval && (latest.f1 < prodEval.f1 || latest.p95_latency_ms > prodEval.p95_latency_ms * 1.1)) {
      throw new Error('Candidate does not meet production F1 and latency gates')
    }
    const now = new Date()
    await this.versions.updateMany({ status: 'production', ...scope }, { $set: { status: 'retired', retired_at: now } })
    await this.versions.updateOne({ id: versionId }, { $set: { status: 'production', promoted_at: now, retired_at: null } })
    return { ...candidate, status: 'production', promoted_at: now, retired_at: null }
  }

  async retire(versionId: string): Promise<void> {
    await this.versions.updateOne({ id: versionId }, { $set: { status: 'retired', retired_at: new Date() } })
  }

  async resolve(metadata: PromptVersion['metadata'], tenantId: string): Promise<PromptVersion | null> {
    const scope = metadata.skill_id
      ? { 'metadata.skill_id': metadata.skill_id }
      : metadata.detector_id
        ? { 'metadata.detector_id': metadata.detector_id }
        : { 'metadata.call_type': metadata.call_type }
    const versions = await this.versions.find({ ...scope, status: { $in: ['production', 'a_b_test'] } })
      .sort({ created_at: -1 }).toArray() as PromptVersion[]
    const candidate = versions.find(version => version.status === 'a_b_test')
    const production = versions.find(version => version.status === 'production') ?? null
    if (!candidate) return production
    const bucket = parseInt(createHash('sha256').update(tenantId).digest('hex').slice(0, 8), 16) % 10
    return bucket === 0 ? candidate : production
  }

  async recordSpan(span: LlmSpan): Promise<void> {
    await this.spans.insertOne(span)
  }
}

function promptScope(version: PromptVersion): Record<string, string> {
  if (version.metadata.skill_id) return { 'metadata.skill_id': version.metadata.skill_id }
  if (version.metadata.detector_id) return { 'metadata.detector_id': version.metadata.detector_id }
  return { 'metadata.call_type': version.metadata.call_type }
}
