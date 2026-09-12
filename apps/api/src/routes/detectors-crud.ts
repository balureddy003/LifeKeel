/**
 * Detector CRUD — create / update / delete / validate / test detectors.
 * Detectors are stored as YAML files under packages/engine/detectors/.
 * The engine hot-reloads automatically in dev (fs.watch), so saves are live.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Engine } from '@kairos/engine'
import type { Db } from 'mongodb'
import type { DetectorVersion } from '@kairos/engine'
import { readFile, writeFile, unlink, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { getAuditLogger } from '../audit/audit-log.js'
import { createLogger } from '@kairos/platform'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getCache } from '../lib/redis-cache.js'
import { initDetectorVersionsCollection } from '../db/detector-versions.js'
import { readdirSync, readFileSync } from 'node:fs'

const log = createLogger({ service: 'detectors-crud', version: '0.0.0' })

// Detectors live at the repo root under /detectors/ (same path the engine loads from).
// apps/api/src/routes/ → ../../../../.. → repo root → detectors/
const DETECTORS_DIR = join(
  new URL(import.meta.url).pathname,
  '../../../../..',
  'detectors',
)

const detectorPathCache = new Map<string, string>()

function findYamlFiles(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findYamlFiles(fullPath))
    } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

function readDetectorId(filePath: string): string | undefined {
  try {
    const raw = readFileSync(filePath, 'utf8')
    const match = raw.match(/^id:\s*(.+)$/m)
    if (!match) return undefined
    return match[1].trim()
  } catch {
    return undefined
  }
}

function resolveDetectorPath(id: string): string | undefined {
  const cached = detectorPathCache.get(id)
  if (cached && existsSync(cached) && readDetectorId(cached) === id) return cached

  for (const file of findYamlFiles(DETECTORS_DIR)) {
    const fileId = readDetectorId(file)
    if (fileId === id) {
      detectorPathCache.set(id, file)
      return file
    }
  }
  return undefined
}

function invalidateDetectorPathCache(id?: string): void {
  if (id) detectorPathCache.delete(id)
  else detectorPathCache.clear()
}

interface NoveltyConfigBody {
  fields: string[]
  min_novelty?: number
  field?: string
}

interface CUSUMConfigBody {
  field: string
  slack?: number
  threshold?: number
  direction?: 'up' | 'down' | 'both'
  min_observations?: number
}

interface ScoreModelConfigBody {
  features: string[]
  min_score?: number
  use_bigrams?: boolean
  l2_reg?: number
}

interface BlendPolicyBody {
  rule_weight: number
  llm_weight: number
  llm_weight_ceiling: number
  rationale?: string
}

interface DetectorRuleBody {
  id: string
  name: string
  condition?: string
  confidence: number
  impact_low: number
  impact_high: number
  urgency: 'low' | 'medium' | 'high' | 'critical'
  category: string
  reasoning: string
  actions: string[]
  suppress_if?: string
  // Lightweight ML extensions
  novelty?: NoveltyConfigBody
  cusum?: CUSUMConfigBody
  score_model?: ScoreModelConfigBody
}

interface DetectorBody {
  id: string
  name: string
  description?: string
  version: string
  signal_types: string[]
  industries?: string[]
  rules: DetectorRuleBody[]
  blend_policy?: BlendPolicyBody
}

function requireAdmin(request: { authContext: { roles: string[] } }, reply: FastifyReply): boolean {
  if (request.authContext.roles.includes('admin')) return true
  reply.status(403).send({ error: 'Admin role required' })
  return false
}

function toYaml(d: DetectorBody): string {
  const indent = (s: string, n: number) => s.split('\n').map(l => ' '.repeat(n) + l).join('\n')
  const lines: string[] = [
    `id: ${d.id}`,
    `name: "${d.name.replace(/"/g, '\\"')}"`,
    ...(d.description ? [`description: "${d.description.replace(/"/g, '\\"')}"`] : []),
    `version: "${d.version}"`,
    `signal_types:`,
    ...d.signal_types.map(s => `  - ${s}`),
    ...(d.industries?.length ? [`industries:`, ...d.industries.map(i => `  - ${i}`)] : []),
    ...(d.blend_policy ? [
      `blend_policy:`,
      `  rule_weight: ${d.blend_policy.rule_weight}`,
      `  llm_weight: ${d.blend_policy.llm_weight}`,
      `  llm_weight_ceiling: ${d.blend_policy.llm_weight_ceiling}`,
      ...(d.blend_policy.rationale ? [`  rationale: "${d.blend_policy.rationale.replace(/"/g, '\\"')}"`] : []),
    ] : []),
    `rules:`,
  ]

  for (const r of d.rules) {
    lines.push(`  - id: ${r.id}`)
    lines.push(`    name: "${r.name.replace(/"/g, '\\"')}"`)
    if (r.condition) {
      lines.push(`    condition: "${r.condition.replace(/"/g, '\\"')}"`)
    }
    lines.push(`    confidence: ${r.confidence}`)
    lines.push(`    urgency: ${r.urgency}`)
    lines.push(`    category: ${r.category}`)
    lines.push(`    impact_low: ${r.impact_low}`)
    lines.push(`    impact_high: ${r.impact_high}`)
    lines.push(`    reasoning_template: |`)
    lines.push(indent(r.reasoning.trim(), 6))
    if (r.suppress_if) {
      lines.push(`    suppress_if: "${r.suppress_if.replace(/"/g, '\\"')}"`)
    }
    if (r.actions.length) {
      lines.push(`    actions:`)
      for (const a of r.actions) lines.push(`      - "${a.replace(/"/g, '\\"')}"`)
    }
    // ── Lightweight ML extensions ─────────────────────────────────────────
    if (r.novelty) {
      lines.push(`    novelty:`)
      lines.push(`      fields:`)
      for (const f of r.novelty.fields) lines.push(`        - ${f}`)
      if (r.novelty.min_novelty !== undefined) lines.push(`      min_novelty: ${r.novelty.min_novelty}`)
      if (r.novelty.field) lines.push(`      field: ${r.novelty.field}`)
    }
    if (r.cusum) {
      lines.push(`    cusum:`)
      lines.push(`      field: ${r.cusum.field}`)
      if (r.cusum.slack !== undefined) lines.push(`      slack: ${r.cusum.slack}`)
      if (r.cusum.threshold !== undefined) lines.push(`      threshold: ${r.cusum.threshold}`)
      if (r.cusum.direction) lines.push(`      direction: ${r.cusum.direction}`)
      if (r.cusum.min_observations !== undefined) lines.push(`      min_observations: ${r.cusum.min_observations}`)
    }
    if (r.score_model) {
      lines.push(`    score_model:`)
      lines.push(`      features:`)
      for (const f of r.score_model.features) lines.push(`        - ${f}`)
      if (r.score_model.min_score !== undefined) lines.push(`      min_score: ${r.score_model.min_score}`)
      if (r.score_model.use_bigrams !== undefined) lines.push(`      use_bigrams: ${r.score_model.use_bigrams}`)
      if (r.score_model.l2_reg !== undefined) lines.push(`      l2_reg: ${r.score_model.l2_reg}`)
    }
  }

  return lines.join('\n') + '\n'
}

// ── Versioning helpers ────────────────────────────────────────────────────────

async function saveVersion(
  db: Db | undefined,
  detectorId: string,
  newYaml: string,
  _ruleCount: number,
  userId: string,
  changeType: 'manual_edit' | 'skill_optimizer' | 'blend_policy_change' | 'rollback' = 'manual_edit',
  beforeYaml?: string,
  tenantId?: string,
): Promise<void> {
  if (!db) return
  
  // Initialize collection if needed
  initDetectorVersionsCollection(db)
  
  const col = db.collection<DetectorVersion>('detector_versions')
  
  // Auto-increment version_number per detector
  const last = await col.find({ detector_id: detectorId }).sort({ version_number: -1 }).limit(1).toArray()
  const version_number = last.length > 0 ? ((last[0]?.['version_number'] as number) ?? 0) + 1 : 1
  
  // Compute semver based on change type
  const lastVersion = last[0]
  let [major, minor, patch] = lastVersion?.version?.split('.').map(Number) ?? [1, 0, 0]
  if (changeType === 'skill_optimizer') {
    minor++
    patch = 0
  } else if (changeType === 'blend_policy_change') {
    minor++
    patch = 0
  } else {
    patch++
  }
  const version = `${major}.${minor}.${patch}`
  
  // Get metrics at time of change (approval rate, avg confidence)
  const metricsAtChange = await getDetectorMetrics(db, detectorId, tenantId)
  
  // Generate change summary
  const changeSummary = diffSummary(beforeYaml ?? null, newYaml)
  
  const now = new Date()
  const versionDoc: DetectorVersion = {
    id: randomUUID(),
    tenant_id: 'system', // System-level changes for now, could be tenant-specific later
    detector_id: detectorId,
    version_number,
    version,
    previous_version: lastVersion?.version,
    changed_by: userId,
    change_type: changeType,
    before_yaml: beforeYaml || '',
    after_yaml: newYaml,
    change_summary: changeSummary,
    metrics_at_change: metricsAtChange,
    approval_rate_at_change: metricsAtChange?.approval_rate,
    created_at: now,
    changed_at: now,
  }
  
  await col.insertOne(versionDoc)
}

async function getDetectorMetrics(db: Db, detectorId: string, tenantId?: string): Promise<{ approval_rate: number; avg_confidence: number } | undefined> {
  try {
    // Get insights for this detector to calculate metrics
    // Scoped to tenant_id to prevent cross-tenant data leakage
    const filter: Record<string, unknown> = { detector_id: detectorId }
    if (tenantId) filter.tenant_id = tenantId
    const insights = await db.collection('insights')
      .find(filter)
      .limit(1000)
      .toArray()
    
    if (insights.length === 0) return undefined
    
    const completed = insights.filter(i => i.state === 'completed').length
    const approval_rate = completed / insights.length
    
    const avgConfidence = insights.reduce((sum, i) => sum + (i.confidence_breakdown?.combined_score ?? 0), 0) / insights.length
    
    return { approval_rate, avg_confidence: avgConfidence }
  } catch (err) {
    log.error({ err }, 'Failed to get detector metrics')
    return undefined
  }
}

function diffSummary(currentYaml: string | null, newYaml: string): string {
  if (!currentYaml) return 'Initial version'
  
  // Check for blend policy changes
  const currentBlend = currentYaml.match(/blend_policy:([\s\S]*?)(?=\n(?:rules|industries|signal_types)|$)/)
  const newBlend = newYaml.match(/blend_policy:([\s\S]*?)(?=\n(?:rules|industries|signal_types)|$)/)
  
  if ((currentBlend && !newBlend) || (!currentBlend && newBlend)) {
    return 'Blend policy added/removed'
  }
  
  if (currentBlend && newBlend && currentBlend[1] !== newBlend[1]) {
    return 'Blend policy updated'
  }
  
  const added = (newYaml.match(/^  - id:/mg) ?? []).length
  const prev = (currentYaml.match(/^  - id:/mg) ?? []).length
  if (added === prev) return 'Rules updated'
  if (added > prev) return `${added - prev} rule(s) added`
  return `${prev - added} rule(s) removed`
}

export async function registerDetectorCrudRoutes(
  app: FastifyInstance,
  engine: Engine,
  db?: Db,
): Promise<void> {

  /** GET /detectors/files — list raw YAML file names (admin only) */
  app.get('/detectors/files', async (_request, reply) => {
    if (!existsSync(DETECTORS_DIR)) return reply.send({ files: [] })
    const files = (await readdir(DETECTORS_DIR)).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    return reply.send({ files })
  })

  /** POST /detectors/validate — validate config without saving */
  app.post<{ Body: DetectorBody }>('/detectors/validate', async (request, reply) => {
    const body = request.body
    const errors: string[] = []
    const warnings: string[] = []

    if (!body.id?.match(/^[a-z][a-z0-9_-]*$/)) errors.push('id must be lowercase snake_case')
    if (!body.name?.trim()) errors.push('name is required')
    if (!body.signal_types?.length) errors.push('at least one signal_type required')
    if (!body.rules?.length) errors.push('at least one rule required')

    // Validate blend policy if present
    if (body.blend_policy) {
      const { rule_weight, llm_weight, llm_weight_ceiling } = body.blend_policy
      if (rule_weight < 0.5 || rule_weight > 1.0) errors.push('rule_weight must be between 0.5 and 1.0')
      if (llm_weight < 0 || llm_weight > 0.5) errors.push('llm_weight must be between 0 and 0.5')
      if (llm_weight_ceiling < 0 || llm_weight_ceiling > 0.9) errors.push('llm_weight_ceiling must be between 0 and 0.9')
      if (Math.abs(rule_weight + llm_weight - 1.0) >= 0.01) errors.push('rule_weight + llm_weight must sum to 1.0')
    }

    for (const r of body.rules ?? []) {
      if (!r.id?.match(/^[a-z][a-z0-9_-]*$/)) errors.push(`rule.id "${r.id}" must be lowercase snake_case`)
      if (!r.condition?.trim() && !r.score_model) errors.push(`rule "${r.id}" must have a condition or score_model`)
      if (r.confidence < 0 || r.confidence > 1) errors.push(`rule "${r.id}" confidence must be 0–1`)
      if (r.confidence < 0.7) warnings.push(`rule "${r.id}" confidence ${r.confidence} is below the OR-score floor of 0.7`)
      if (r.impact_low < 0) errors.push(`rule "${r.id}" impact_low must be ≥ 0`)
      if (r.impact_high < r.impact_low) errors.push(`rule "${r.id}" impact_high must be ≥ impact_low`)
    }

    return reply.send({ valid: errors.length === 0, errors, warnings })
  })

  /** POST /detectors/test — run engine on a sample event */
  app.post<{ Body: { event_type: string; data: Record<string, unknown> } }>(
    '/detectors/test',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { event_type, data } = request.body

      const result = await engine.evaluate({
        event_type,
        tenant_id,
        event_id: `test_${Date.now()}`,
        data,
      })

      return reply.send({
        insights: result.insights,
        detectors_run: result.detectors_run,
        rules_triggered: result.rules_triggered,
        latency_ms: result.latency_ms,
      })
    },
  )

  /** POST /detectors — create and save a new detector */
  app.post<{ Body: DetectorBody }>('/detectors', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const body = request.body

    // Validate first
    const errors: string[] = []
    if (!body.id?.match(/^[a-z][a-z0-9_-]*$/)) errors.push('id must be lowercase snake_case')
    if (!body.name?.trim()) errors.push('name is required')
    if (!body.signal_types?.length) errors.push('at least one signal_type required')
    if (!body.rules?.length) errors.push('at least one rule required')
    if (errors.length) return reply.status(400).send({ error: errors.join('; ') })

    const existingPath = resolveDetectorPath(body.id)
    if (existingPath) {
      return reply.status(409).send({ error: `Detector "${body.id}" already exists` })
    }

    // New detectors are always created at the repo root for now.
    const filePath = join(DETECTORS_DIR, `${body.id}.yaml`)
    const yaml = toYaml(body)
    await writeFile(filePath, yaml, 'utf8')
    invalidateDetectorPathCache(body.id)
    const userId = (request.authContext as { user_id?: string })?.user_id ?? 'unknown'
    await saveVersion(db, body.id, yaml, body.rules.length, userId, 'manual_edit', undefined, request.authContext.tenant_id)
    getAuditLogger()?.fromRequest(request, 'detector.create', 'detector', body.id, { version: body.version, rules: body.rules.length })

    // Invalidate cache
    const cache = getCache()
    await cache.delete('detector:inventory')

    return reply.status(201).send({ id: body.id, message: 'Detector created — hot-reload triggered' })
  })

  /** PUT /detectors/:id — update existing detector */
  app.put<{ Params: { id: string }; Body: DetectorBody }>(
    '/detectors/:id',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const { id } = request.params
      const body = request.body

      const filePath = resolveDetectorPath(id)
      if (!filePath) {
        return reply.status(404).send({ error: `Detector "${id}" not found` })
      }

      // Read existing YAML before update
      const beforeYaml = await readFile(filePath, 'utf8')
      
      // Detect blend policy changes
      const currentBlend = beforeYaml.match(/blend_policy:([\s\S]*?)(?=\n(?:rules|industries|signal_types)|$)/)
      const newBlend = toYaml({ ...body, id }).match(/blend_policy:([\s\S]*?)(?=\n(?:rules|industries|signal_types)|$)/)
      const blendChanged = (currentBlend && !newBlend) || (!currentBlend && newBlend) || (currentBlend && newBlend && currentBlend[1] !== newBlend[1])
      
      const changeType = blendChanged ? 'blend_policy_change' : 'manual_edit'
      
      const newYaml = toYaml({ ...body, id })
      await writeFile(filePath, newYaml, 'utf8')
      invalidateDetectorPathCache(id)
      const userId = (request.authContext as { user_id?: string })?.user_id ?? 'unknown'
      await saveVersion(db, id, newYaml, body.rules.length, userId, changeType, beforeYaml, request.authContext.tenant_id)
      getAuditLogger()?.fromRequest(request, 'detector.update', 'detector', id, { version: body.version })
      
      // Invalidate cache
      const cache = getCache()
      await cache.delete('detector:inventory')
      
      return reply.send({ id, message: 'Detector updated — hot-reload triggered' })
    },
  )

  /** DELETE /detectors/:id — remove detector file */
  app.delete<{ Params: { id: string } }>('/detectors/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const { id } = request.params
    const filePath = resolveDetectorPath(id)

    if (!filePath) {
      return reply.status(404).send({ error: `Detector "${id}" not found` })
    }

    await unlink(filePath)
    invalidateDetectorPathCache(id)
    getAuditLogger()?.fromRequest(request, 'detector.delete', 'detector', id)
    
    // Invalidate cache
    const cache = getCache()
    await cache.delete('detector:inventory')
    
    return reply.send({ id, message: 'Detector deleted' })
  })

  /** GET /detectors/:id/source — raw YAML source */
  app.get<{ Params: { id: string } }>('/detectors/:id/source', async (request, reply) => {
    const { id } = request.params
    const filePath = resolveDetectorPath(id)

    if (!filePath) {
      return reply.status(404).send({ error: `Detector "${id}" not found` })
    }

    const source = await readFile(filePath, 'utf8')
    return reply.send({ id, source })
  })

  /** GET /detectors/:id/file-versions — list all saved file versions */
  app.get<{ Params: { id: string } }>('/detectors/:id/file-versions', async (request, reply) => {
    const { id } = request.params
    if (!db) return reply.send({ versions: [] })

    const col = db.collection<DetectorVersion>('detector_versions')
    const docs = await col
      .find({ detector_id: id })
      .sort({ version_number: -1 })
      .toArray()

    const versions = docs.map(doc => ({
      id: doc.id,
      version_number: doc.version_number,
      changed_by: doc.changed_by,
      change_type: doc.change_type,
      change_summary: doc.change_summary,
      metrics_at_change: doc.metrics_at_change,
      created_at: doc.created_at,
    }))

    return reply.send({ versions })
  })

  /** GET /detectors/:id/file-versions/:versionNumber — get full YAML of a specific file version */
  app.get<{ Params: { id: string; versionNumber: string } }>(
    '/detectors/:id/file-versions/:versionNumber',
    async (request, reply) => {
      const { id, versionNumber } = request.params
      if (!db) return reply.status(503).send({ error: 'Versioning requires MongoDB' })

      const col = db.collection<DetectorVersion>('detector_versions')
      const doc = await col.findOne({ detector_id: id, version_number: parseInt(versionNumber, 10) })
      if (!doc) return reply.status(404).send({ error: `Version ${versionNumber} not found` })

      return reply.send({
        detector_id: id,
        version_number: doc.version_number,
        yaml: doc.after_yaml,
        change_summary: doc.change_summary,
        changed_by: doc.changed_by,
        created_at: doc.created_at,
      })
    },
  )

  /** GET /detectors/:id/versions — returns detector version history */
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    '/detectors/:id/versions',
    async (request, reply) => {
      const { id } = request.params
      const limit = parseInt(request.query.limit ?? '50', 10)
      const offset = parseInt(request.query.offset ?? '0', 10)
      
      if (!db) return reply.status(503).send({ error: 'Versioning requires MongoDB' })
      
      const col = db.collection<DetectorVersion>('detector_versions')
      const versions = await col
        .find({ detector_id: id })
        .sort({ version_number: -1 })
        .skip(offset)
        .limit(limit)
        .toArray()
      
      const total = await col.countDocuments({ detector_id: id })
      
      return reply.send({
        detector_id: id,
        versions: versions.map(v => ({
          id: v.id,
          version: v.version,
          version_number: v.version_number,
          previous_version: v.previous_version,
          changed_by: v.changed_by,
          change_type: v.change_type,
          change_summary: v.change_summary,
          diff: v.diff,
          metrics_at_change: v.metrics_at_change,
          approval_rate_at_change: v.approval_rate_at_change,
          created_at: v.created_at,
          changed_at: v.changed_at,
        })),
        total,
        limit,
        offset,
      })
    },
  )

  /** POST /detectors/:id/versions/:versionId/rollback — restore a version as current YAML */
  app.post<{ Params: { id: string; versionId: string } }>(
    '/detectors/:id/versions/:versionId/rollback',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const { id, versionId } = request.params
      if (!db) return reply.status(503).send({ error: 'Versioning requires MongoDB' })

      const col = db.collection<DetectorVersion>('detector_versions')
      const targetVersion = await col.findOne({ detector_id: id, id: versionId })
      if (!targetVersion) return reply.status(404).send({ error: `Version ${versionId} not found` })

      const filePath = resolveDetectorPath(id)
      if (!filePath) {
        return reply.status(404).send({ error: `Detector "${id}" not found` })
      }

      // Read current YAML before rollback
      const currentYaml = await readFile(filePath, 'utf8')

      // Write the target version's YAML
      await writeFile(filePath, targetVersion.after_yaml, 'utf8')
      invalidateDetectorPathCache(id)

      // Save a new version snapshot for the rollback itself
      const userId = (request.authContext as { user_id?: string })?.user_id ?? 'unknown'
      await saveVersion(
        db,
        id,
        targetVersion.after_yaml,
        targetVersion.after_yaml.split('\n').filter(l => l.includes('  - id:')).length,
        userId,
        'rollback',
        currentYaml,
        request.authContext.tenant_id,
      )

      getAuditLogger()?.fromRequest(request, 'detector.rollback', 'detector', id, {
        rolled_back_to: versionId,
        target_version_number: targetVersion.version_number,
      })

      return reply.send({ 
        id, 
        rolled_back_to: versionId,
        target_version_number: targetVersion.version_number,
        message: `Rolled back to version ${targetVersion.version_number}` 
      })
    },
  )
}
