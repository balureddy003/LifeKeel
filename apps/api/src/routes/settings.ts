/**
 * Settings routes — tenant LLM configuration.
 *
 * GET  /settings/llm          — load current LLM config for tenant (keys masked)
 * POST /settings/llm          — save / update LLM config
 * POST /settings/llm/test     — test a provider config with a real ping call
 * DELETE /settings/llm        — remove saved config (revert to env vars)
 *
 * API keys are AES-256-GCM encrypted before storing in MongoDB.
 * The encryption key is SETTINGS_ENCRYPTION_KEY env var (32-byte hex).
 * If not set, keys are stored obfuscated (base64) with a warning.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { GoalMigrationWorker } from '../jobs/goal-migration-worker.js'
import { createLogger } from '@agentoak/platform'
import {
  DEFAULT_KPI_DISCREPANCY_THRESHOLD_PCT,
  DEFAULT_KPI_SOURCE_TYPE_PRIORITIES,
  getKpiSourceSettings,
} from '../goals/kpi-source-reconciliation.js'

const log = createLogger({ service: 'settings', version: '0.0.0' })

export interface LlmSettings {
  provider: 'anthropic' | 'openai' | 'azure' | 'groq' | 'ollama'
  model: string
  api_key?: string           // stored encrypted; returned masked as '••••••••<last4>'
  azure_endpoint?: string
  azure_deployment?: string
  azure_api_version?: string
  ollama_base_url?: string
  temperature: number
  max_tokens: number
  tier_models?: Record<string, string>  // fast/balanced/powerful → model overrides
  updated_at: string
}

// ── Encryption helpers ────────────────────────────────────────────────────────

const ENC_KEY_HEX = process.env['SETTINGS_ENCRYPTION_KEY'] ?? ''
const ENC_ALGO = 'aes-256-gcm'

function getEncKey(): Buffer | null {
  if (ENC_KEY_HEX.length === 64) return Buffer.from(ENC_KEY_HEX, 'hex')
  return null
}

function encrypt(plaintext: string): string {
  const key = getEncKey()
  if (!key) {
    // Warn once, fall back to base64 obfuscation
    return 'b64:' + Buffer.from(plaintext).toString('base64')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv(ENC_ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv(12B) + tag(16B) + ciphertext, all hex
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

function decrypt(stored: string): string {
  if (stored.startsWith('b64:')) {
    return Buffer.from(stored.slice(4), 'base64').toString('utf8')
  }
  const key = getEncKey()
  if (!key) throw new Error('SETTINGS_ENCRYPTION_KEY not set but encrypted value found')
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted format')
  const iv = Buffer.from(parts[0]!, 'hex')
  const tag = Buffer.from(parts[1]!, 'hex')
  const ciphertext = Buffer.from(parts[2]!, 'hex')
  const decipher = createDecipheriv(ENC_ALGO, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return '••••••••'
  return '••••••••' + apiKey.slice(-4)
}

// ── Stored document shape (in MongoDB) ───────────────────────────────────────

interface LlmSettingsDoc {
  tenant_id: string
  provider: string
  model: string
  api_key_enc?: string        // encrypted
  azure_endpoint?: string
  azure_deployment?: string
  azure_api_version?: string
  ollama_base_url?: string
  temperature: number
  max_tokens: number
  tier_models?: Record<string, string>
  updated_at: string
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerSettingsRoutes(fastify: FastifyInstance, db: Db): void {
  const col = db.collection<LlmSettingsDoc>('tenant_llm_settings')
  const tenantSettings = db.collection('tenant_settings')

  fastify.get('/settings/goal-data-sources', async req => {
    return getKpiSourceSettings(db, req.authContext.tenant_id)
  })

  fastify.put<{
    Body: {
      source_priorities?: Record<string, number>
      source_type_priorities?: Partial<Record<'connector' | 'computed' | 'manual', number>>
      discrepancy_threshold_pct?: number
      metric_units?: Record<string, string>
    }
  }>('/settings/goal-data-sources', async (req, reply) => {
    const threshold = req.body.discrepancy_threshold_pct ?? DEFAULT_KPI_DISCREPANCY_THRESHOLD_PCT
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      return reply.status(400).send({ error: 'discrepancy_threshold_pct must be between 0 and 100' })
    }
    const sourcePriorities = req.body.source_priorities ?? {}
    if (Object.values(sourcePriorities).some(value => !Number.isFinite(value))) {
      return reply.status(400).send({ error: 'source priorities must be finite numbers' })
    }
    const goalDataSources = {
      source_priorities: sourcePriorities,
      source_type_priorities: {
        ...DEFAULT_KPI_SOURCE_TYPE_PRIORITIES,
        ...(req.body.source_type_priorities ?? {}),
      },
      discrepancy_threshold_pct: threshold,
      metric_units: req.body.metric_units ?? {},
    }
    await tenantSettings.updateOne(
      { tenant_id: req.authContext.tenant_id },
      { $set: { tenant_id: req.authContext.tenant_id, goal_data_sources: goalDataSources, updated_at: new Date() } },
      { upsert: true },
    )
    return goalDataSources
  })

  // Rebalance-preview tax estimate — was a hardcoded 20% CGT assumption in
  // apps/api/src/routes/portfolio.ts with no way for a tenant to correct it
  // for their actual tax situation. Small, single-field setting rather than
  // a full tax-bracket system: turns a silent assumption into a visible,
  // overridable one, surfaced in RebalanceModal's cost panel.
  const DEFAULT_TAX_RATE_PCT = 20

  fastify.get('/settings/tax-rate', async req => {
    const settings = await tenantSettings.findOne({ tenant_id: req.authContext.tenant_id })
    const stored = settings?.['tax_rate_pct']
    return { tax_rate_pct: typeof stored === 'number' ? stored : DEFAULT_TAX_RATE_PCT }
  })

  fastify.put<{ Body: { tax_rate_pct: number } }>('/settings/tax-rate', async (req, reply) => {
    const rate = req.body.tax_rate_pct
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return reply.status(400).send({ error: 'tax_rate_pct must be between 0 and 100' })
    }
    await tenantSettings.updateOne(
      { tenant_id: req.authContext.tenant_id },
      { $set: { tenant_id: req.authContext.tenant_id, tax_rate_pct: rate, updated_at: new Date() } },
      { upsert: true },
    )
    return { tax_rate_pct: rate }
  })

  fastify.get('/settings/costs', async req => {
    const settings = await tenantSettings.findOne({ tenant_id: req.authContext.tenant_id })
    return { llm_budget: settings?.['llm_budget'] ?? { monthly_limit_usd: null, alert_threshold_pct: 80, hard_stop: false, reset_day: 1 } }
  })

  fastify.put<{
    Body: { monthly_limit_usd: number; alert_threshold_pct?: number; hard_stop?: boolean; per_detector_limit_usd?: Record<string, number>; reset_day?: number }
  }>('/settings/costs', async (req, reply) => {
    if (!(req.body.monthly_limit_usd > 0)) return reply.status(400).send({ error: 'monthly_limit_usd must be positive' })
    const llm_budget = { monthly_limit_usd: req.body.monthly_limit_usd, alert_threshold_pct: req.body.alert_threshold_pct ?? 80, hard_stop: req.body.hard_stop ?? false, per_detector_limit_usd: req.body.per_detector_limit_usd ?? {}, reset_day: req.body.reset_day ?? 1 }
    await tenantSettings.updateOne({ tenant_id: req.authContext.tenant_id }, { $set: { llm_budget, updated_at: new Date() } }, { upsert: true })
    return { llm_budget }
  })

  fastify.get('/settings/ml-isolation', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const settings = await tenantSettings.findOne({ tenant_id })
    return {
      ml_isolation_mode: settings?.['ml_isolation_mode'] ?? 'standard',
      data_sharing: settings?.['data_sharing'] === true,
    }
  })

  fastify.put<{
    Body: { ml_isolation_mode?: 'standard' | 'strict' | 'isolated'; data_sharing?: boolean }
  }>('/settings/ml-isolation', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const ml_isolation_mode = req.body.ml_isolation_mode ?? 'standard'
    const data_sharing = req.body.data_sharing === true
    await tenantSettings.updateOne(
      { tenant_id },
      { $set: { tenant_id, ml_isolation_mode, data_sharing, updated_at: new Date() } },
      { upsert: true },
    )
    return { ml_isolation_mode, data_sharing }
  })

  // GET /settings/automation — return automation settings with defaults
  fastify.get('/settings/automation', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const settings = await tenantSettings.findOne({ tenant_id })
    const automation = settings?.['automation'] as { dry_run_mode?: boolean; trust_level_by_workflow?: Record<string, number> } | undefined
    return {
      dry_run_mode: automation?.dry_run_mode ?? true, // Default to true for new tenants
      trust_level_by_workflow: automation?.trust_level_by_workflow ?? {},
    }
  })

  // PATCH /settings/automation — update automation settings
  fastify.patch<{
    Body: { dry_run_mode?: boolean }
  }>('/settings/automation', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const { dry_run_mode } = req.body
    
    // Get existing automation settings or create defaults
    const existing = await tenantSettings.findOne({ tenant_id })
    const automation = (existing?.['automation'] as { dry_run_mode?: boolean; trust_level_by_workflow?: Record<string, number> } | undefined) ?? {
      dry_run_mode: true,
      trust_level_by_workflow: {},
    }
    
    // Update with new values
    const updated = {
      ...automation,
      ...(dry_run_mode !== undefined && { dry_run_mode }),
    }
    
    await tenantSettings.updateOne(
      { tenant_id },
      { $set: { automation: updated, updated_at: new Date() } },
      { upsert: true },
    )
    
    return updated
  })

  // GET /settings/automation/trust — return trust levels per workflow
  fastify.get('/settings/automation/trust', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const settings = await tenantSettings.findOne({ tenant_id })
    const automation = settings?.['automation'] as { trust_level_by_workflow?: Record<string, number> } | undefined
    return {
      trust_level_by_workflow: automation?.trust_level_by_workflow ?? {},
    }
  })

  // GET /settings/optimizer-quota — return optimizer quota config for tenant
  fastify.get('/settings/optimizer-quota', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const settings = await tenantSettings.findOne({ tenant_id })
    const optimizerQuota = settings?.['optimizer_quota'] as {
      max_runs_per_detector_per_day?: number
      max_runs_per_tenant_per_day?: number
      min_approvals_since_last_run?: number
    } | undefined
    
    // Return defaults if not set
    return {
      max_runs_per_detector_per_day: optimizerQuota?.max_runs_per_detector_per_day ?? 1,
      max_runs_per_tenant_per_day: optimizerQuota?.max_runs_per_tenant_per_day ?? 5,
      min_approvals_since_last_run: optimizerQuota?.min_approvals_since_last_run ?? 10,
    }
  })

  // PATCH /settings/optimizer-quota — update optimizer quota config
  fastify.patch<{
    Body: {
      max_runs_per_detector_per_day?: number
      max_runs_per_tenant_per_day?: number
      min_approvals_since_last_run?: number
    }
  }>('/settings/optimizer-quota', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const { max_runs_per_detector_per_day, max_runs_per_tenant_per_day, min_approvals_since_last_run } = req.body
    
    // Get existing optimizer quota or create defaults
    const existing = await tenantSettings.findOne({ tenant_id })
    const optimizerQuota = (existing?.['optimizer_quota'] as {
      max_runs_per_detector_per_day?: number
      max_runs_per_tenant_per_day?: number
      min_approvals_since_last_run?: number
    } | undefined) ?? {
      max_runs_per_detector_per_day: 1,
      max_runs_per_tenant_per_day: 5,
      min_approvals_since_last_run: 10,
    }
    
    // Update with new values
    const updated = {
      ...optimizerQuota,
      ...(max_runs_per_detector_per_day !== undefined && { max_runs_per_detector_per_day }),
      ...(max_runs_per_tenant_per_day !== undefined && { max_runs_per_tenant_per_day }),
      ...(min_approvals_since_last_run !== undefined && { min_approvals_since_last_run }),
    }
    
    await tenantSettings.updateOne(
      { tenant_id },
      { $set: { optimizer_quota: updated, updated_at: new Date() } },
      { upsert: true },
    )
    
    return updated
  })

  // GET /settings/benchmarks — return benchmark opt-in status
  fastify.get('/settings/benchmarks', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const settings = await tenantSettings.findOne({ tenant_id })
    const benchmarks = settings?.['benchmarks'] as { opted_in?: boolean } | undefined
    
    return {
      opted_in: benchmarks?.opted_in ?? false,
    }
  })

  // PATCH /settings/benchmarks — update benchmark opt-in status
  fastify.patch<{
    Body: { opted_in: boolean }
  }>('/settings/benchmarks', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const { opted_in } = req.body
    
    await tenantSettings.updateOne(
      { tenant_id },
      { $set: { benchmarks: { opted_in, updated_at: new Date() } } },
      { upsert: true },
    )
    
    return { opted_in }
  })

  // ── LLM scoring opt-in (D1b) ──────────────────────────────────────────────
  // Per-tenant opt-in for LLM confidence scoring. When enabled, the engine's
  // LlmScorer enriches insights with LLM-evaluated confidence scores, which
  // are then calibrated by the ScoreCalibrator. When disabled (default),
  // insights keep rule-only confidence scores — no LLM cost or latency.
  fastify.get('/settings/llm-scoring', async (req) => {
    const doc = await tenantSettings.findOne({
      tenant_id: req.authContext.tenant_id,
      key: 'llm_scoring_enabled',
    })
    return { enabled: doc?.['value'] === true }
  })

  fastify.patch<{
    Body: { enabled: boolean }
  }>('/settings/llm-scoring', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const { enabled } = req.body
    await tenantSettings.updateOne(
      { tenant_id, key: 'llm_scoring_enabled' },
      { $set: { tenant_id, key: 'llm_scoring_enabled', value: enabled, updated_at: new Date() } },
      { upsert: true },
    )
    return { enabled }
  })

  // ── EPIC-001: Detector priority settings ───────────────────────────────────
  // Controls how the alert consolidation engine ranks insights from different
  // detectors firing on the same entity. Tenants can override per-detector
  // priorities or adjust the default tier priorities.
  fastify.get('/settings/detector-priorities', async (req) => {
    const settings = await tenantSettings.findOne({ tenant_id: req.authContext.tenant_id })
    const stored = settings?.['detector_priorities'] as {
      detector_priorities?: Record<string, number>
      tier_priorities?: Record<string, number>
    } | undefined
    return {
      detector_priorities: stored?.detector_priorities ?? {},
      tier_priorities: stored?.tier_priorities ?? {
        regulatory: 300,
        deterministic: 200,
        llm_scored: 100,
      },
    }
  })

  fastify.put<{
    Body: {
      detector_priorities?: Record<string, number>
      tier_priorities?: Record<string, number>
      contradiction_actions?: { reduce: string[]; increase: string[] }
    }
  }>('/settings/detector-priorities', async (req, reply) => {
    const detectorPriorities = req.body.detector_priorities ?? {}
    if (Object.values(detectorPriorities).some(v => !Number.isFinite(v))) {
      return reply.status(400).send({ error: 'detector priorities must be finite numbers' })
    }
    const tierPriorities = req.body.tier_priorities ?? {
      regulatory: 300,
      deterministic: 200,
      llm_scored: 100,
    }
    if (Object.values(tierPriorities).some(v => !Number.isFinite(v))) {
      return reply.status(400).send({ error: 'tier priorities must be finite numbers' })
    }
    const detectorPrioritySettings = {
      detector_priorities: detectorPriorities,
      tier_priorities: tierPriorities,
      ...(req.body.contradiction_actions ? { contradiction_actions: req.body.contradiction_actions } : {}),
    }
    await tenantSettings.updateOne(
      { tenant_id: req.authContext.tenant_id },
      { $set: { tenant_id: req.authContext.tenant_id, detector_priorities: detectorPrioritySettings, updated_at: new Date() } },
      { upsert: true },
    )
    return detectorPrioritySettings
  })

  // ── EPIC-003: Terminology & persona preferences ────────────────────────────
  // Controls how the Studio UI labels concepts (entity nouns, confidence
  // scores, language style) based on the tenant's vertical and persona.
  // Tenants can override the vertical defaults for entity noun and language style.
  fastify.get('/settings/terminology', async (req) => {
    const settings = await tenantSettings.findOne({ tenant_id: req.authContext.tenant_id })
    const stored = settings?.['terminology_preferences'] as {
      language_style?: 'formal' | 'casual' | 'technical'
      entity_noun_override?: string
    } | undefined
    return {
      language_style: stored?.language_style,
      entity_noun_override: stored?.entity_noun_override,
    }
  })

  fastify.put<{
    Body: {
      language_style?: 'formal' | 'casual' | 'technical'
      entity_noun_override?: string
    }
  }>('/settings/terminology', async (req, reply) => {
    const validStyles = ['formal', 'casual', 'technical']
    if (req.body.language_style && !validStyles.includes(req.body.language_style)) {
      return reply.status(400).send({ error: `language_style must be one of: ${validStyles.join(', ')}` })
    }
    const terminologyPreferences = {
      language_style: req.body.language_style,
      entity_noun_override: req.body.entity_noun_override?.trim() || undefined,
    }
    await tenantSettings.updateOne(
      { tenant_id: req.authContext.tenant_id },
      { $set: { tenant_id: req.authContext.tenant_id, terminology_preferences: terminologyPreferences, updated_at: new Date() } },
      { upsert: true },
    )
    return terminologyPreferences
  })

  // GET /settings/notifications — return notification preferences
  fastify.get('/settings/notifications', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const settings = await tenantSettings.findOne({ tenant_id })
    const notifications = settings?.['notifications'] as {
      whatsapp_number?: string
      whatsapp_verified?: boolean
      channels?: string[]
    } | undefined

    return {
      whatsapp_number: notifications?.whatsapp_number ?? null,
      whatsapp_verified: notifications?.whatsapp_verified ?? false,
      channels: notifications?.channels ?? ['email'],
    }
  })

  // PATCH /settings/notifications — update notification preferences
  fastify.patch<{
    Body: {
      whatsapp_number?: string
      channels?: string[]
    }
  }>('/settings/notifications', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const { whatsapp_number, channels } = req.body

    const existing = await tenantSettings.findOne({ tenant_id })
    const notifications = (existing?.['notifications'] as Record<string, unknown> | undefined) ?? {}

    const updated = {
      ...notifications,
      ...(whatsapp_number !== undefined && { whatsapp_number }),
      ...(channels !== undefined && { channels }),
    }

    await tenantSettings.updateOne(
      { tenant_id },
      { $set: { notifications: updated, updated_at: new Date() } },
      { upsert: true },
    )

    return updated
  })

  // POST /settings/notifications/verify-whatsapp — send OTP via Twilio
  fastify.post<{ Body: { whatsapp_number: string } }>('/settings/notifications/verify-whatsapp', async (req, _reply) => {
    const tenant_id = req.authContext.tenant_id
    const { whatsapp_number } = req.body

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    // Store OTP with expiry (10 minutes)
    await tenantSettings.updateOne(
      { tenant_id },
      { $set: { whatsapp_otp: { code: otp, expires_at: new Date(Date.now() + 10 * 60 * 1000), number: whatsapp_number } } },
      { upsert: true },
    )

    // TODO: Integrate with Twilio to send actual WhatsApp message
    // For now, return success in development mode
    if (process.env.NODE_ENV === 'development') {
      return { success: true, otp, message: 'Development mode — OTP not sent via Twilio' }
    }

    return { success: true, message: 'Verification code sent' }
  })

  // POST /settings/notifications/confirm-whatsapp — verify OTP
  fastify.post<{ Body: { otp: string } }>('/settings/notifications/confirm-whatsapp', async (req, reply) => {
    const tenant_id = req.authContext.tenant_id
    const { otp } = req.body

    const settings = await tenantSettings.findOne({ tenant_id })
    const otpRecord = settings?.['whatsapp_otp'] as { code: string; expires_at: Date; number: string } | undefined

    if (!otpRecord) {
      return reply.status(400).send({ error: 'No verification in progress' })
    }

    if (new Date() > new Date(otpRecord.expires_at)) {
      return reply.status(400).send({ error: 'Verification code expired' })
    }

    if (otpRecord.code !== otp) {
      return reply.status(400).send({ error: 'Invalid verification code' })
    }

    // Mark as verified
    const notifications = (settings?.['notifications'] as Record<string, unknown> | undefined) ?? {}
    await tenantSettings.updateOne(
      { tenant_id },
      {
        $set: {
          notifications: { ...notifications, whatsapp_number: otpRecord.number, whatsapp_verified: true },
          updated_at: new Date(),
        },
        $unset: { whatsapp_otp: '' },
      },
    )

    return { success: true, verified: true, whatsapp_number: otpRecord.number }
  })

  fastify.get('/settings/migrations/goals', async (req) => {
    const tenantId = req.authContext.tenant_id
    const [total, migrated, latest] = await Promise.all([
      db.collection('goals').countDocuments({ tenant_id: tenantId }),
      db.collection('goals').countDocuments({ tenant_id: tenantId, migrated: true }),
      db.collection('goals').find({ tenant_id: tenantId }).sort({ updated_at: -1 }).limit(1).toArray(),
    ])
    return {
      total,
      migrated,
      remaining: total - migrated,
      last_goal_activity_at: latest[0]?.['updated_at'] ?? null,
      status: migrated === total ? 'complete' : migrated > 0 ? 'in_progress' : 'pending',
    }
  })

  fastify.post('/settings/migrations/goals/run', async (req, reply) => {
    const worker = new GoalMigrationWorker(db)
    if (!worker.isEnabled()) {
      return reply.status(503).send({
        error: 'Legacy goal migration is disabled. Set GOAL_MIGRATION_ENABLED=true to enable it.',
      })
    }

    return worker.migrateNextBatch(req.authContext.tenant_id)
  })

  // GET /settings/llm — return current config with masked key
  fastify.get('/settings/llm', async (req) => {
    const tenantId = req.authContext.tenant_id
    const doc = await col.findOne({ tenant_id: tenantId })
    if (!doc) {
      // Return defaults derived from env — still useful to show active provider
      return {
        config: null,
        active_provider: detectEnvProvider(),
        has_env_key: !!detectEnvProvider(),
      }
    }
    const { api_key_enc, tenant_id: _tid, ...rest } = doc
    // Decrypting only to re-mask it for display — if it fails (e.g. the
    // stored ciphertext was encrypted under a since-rotated
    // SETTINGS_ENCRYPTION_KEY), that's a display-only degradation, not a
    // reason to fail the whole settings fetch. api_key_set already reflects
    // whether a key is actually configured independent of whether we can
    // still read it back for the masked preview.
    let maskedApiKey: string | undefined
    if (api_key_enc) {
      try {
        maskedApiKey = maskKey(decrypt(api_key_enc))
      } catch (err) {
        req.log.warn({ err, tenant_id: tenantId }, 'Could not decrypt stored LLM api_key for display; masking generically')
        maskedApiKey = '••••••••'
      }
    }
    return {
      config: {
        ...rest,
        api_key: maskedApiKey,
        api_key_set: !!api_key_enc,
        ...(doc.tier_models ? { tier_models: doc.tier_models } : {}),
      },
      active_provider: doc.provider,
      has_env_key: !!detectEnvProvider(),
    }
  })

  // POST /settings/llm — upsert config
  fastify.post<{
    Body: {
      provider: string
      model: string
      api_key?: string
      azure_endpoint?: string
      azure_deployment?: string
      azure_api_version?: string
      ollama_base_url?: string
      temperature?: number
      max_tokens?: number
      tier_models?: Record<string, string>
    }
  }>('/settings/llm', async (req, _reply) => {
    const tenantId = req.authContext.tenant_id
    const { api_key, ...rest } = req.body

    // Preserve existing encrypted key if new one not provided
    let api_key_enc: string | undefined
    if (api_key && api_key !== '••••••••' && !api_key.includes('••')) {
      api_key_enc = encrypt(api_key)
    } else {
      const existing = await col.findOne({ tenant_id: tenantId })
      api_key_enc = existing?.api_key_enc
    }

    // Clean and validate Azure endpoint
    let cleanAzureEndpoint = rest.azure_endpoint
    if (cleanAzureEndpoint) {
      // Remove trailing slash and any /openai path components
      cleanAzureEndpoint = cleanAzureEndpoint.replace(/\/$/, '').replace(/\/openai.*$/, '')
      log.info({ original: rest.azure_endpoint, cleaned: cleanAzureEndpoint }, 'Cleaning Azure endpoint')
    }

    const doc: LlmSettingsDoc = {
      tenant_id: tenantId,
      provider: rest.provider,
      model: rest.model,
      temperature: rest.temperature ?? 0.3,
      max_tokens: rest.max_tokens ?? 2048,
      updated_at: new Date().toISOString(),
      ...(api_key_enc !== undefined ? { api_key_enc } : {}),
      ...(cleanAzureEndpoint !== undefined ? { azure_endpoint: cleanAzureEndpoint } : {}),
      ...(rest.azure_deployment !== undefined ? { azure_deployment: rest.azure_deployment } : {}),
      ...(rest.azure_api_version !== undefined ? { azure_api_version: rest.azure_api_version } : {}),
      ...(rest.ollama_base_url !== undefined ? { ollama_base_url: rest.ollama_base_url } : {}),
      ...(rest.tier_models !== undefined ? { tier_models: rest.tier_models } : {}),
    }

    await col.replaceOne({ tenant_id: tenantId }, doc, { upsert: true })
    return { ok: true, provider: doc.provider, model: doc.model }
  })

  // POST /settings/llm/test — test a provider + key with a lightweight ping
  fastify.post<{
    Body: {
      provider: string
      model: string
      api_key?: string
      azure_endpoint?: string
      azure_deployment?: string
      azure_api_version?: string
      ollama_base_url?: string
    }
  }>('/settings/llm/test', async (req, reply) => {
    const { provider, model, api_key, azure_endpoint, azure_deployment, ollama_base_url } = req.body

    // Resolve the actual key to test with
    let resolvedKey = api_key
    if (!resolvedKey || resolvedKey.includes('••')) {
      // Use saved key
      const tenantId = req.authContext.tenant_id
      const doc = await col.findOne({ tenant_id: tenantId })
      if (doc?.api_key_enc) resolvedKey = decrypt(doc.api_key_enc)
    }

    try {
      // Debug logging for Azure
      if (provider === 'azure') {
        log.info({
          azure_endpoint,
          azure_deployment,
          azure_api_version: req.body.azure_api_version,
          model,
          has_key: !!resolvedKey,
          key_prefix: resolvedKey ? resolvedKey.substring(0, 8) + '...' : 'none'
        }, 'Azure test config')
      }
      
      const { createLlmRouter } = await import('@agentoak/platform')
      const testLlm = createLlmRouter({
        provider: provider as 'anthropic' | 'openai' | 'azure' | 'groq' | 'ollama',
        maxTokens: 10,
        temperature: 0,
        ...(resolvedKey !== undefined ? { apiKey: resolvedKey } : {}),
        ...(azure_endpoint !== undefined ? { azureEndpoint: azure_endpoint } : {}),
        ...(azure_deployment !== undefined ? { azureDeployment: azure_deployment } : {}),
        ...(req.body.azure_api_version !== undefined ? { azureApiVersion: req.body.azure_api_version } : {}),
        ...(ollama_base_url !== undefined ? { ollamaBaseUrl: ollama_base_url } : {}),
      })
      const start = Date.now()
      const response = await testLlm('You are a test.', 'Reply with exactly: OK', model)
      const latencyMs = Date.now() - start
      return { ok: true, provider, model, latency_ms: latencyMs, response: response.slice(0, 100) }
    } catch (err) {
      log.error({ err }, 'LLM test error')
      return reply.status(400).send({ ok: false, error: (err as Error).message })
    }
  })

  // DELETE /settings/llm — remove saved config
  fastify.delete('/settings/llm', async (req) => {
    const tenantId = req.authContext.tenant_id
    await col.deleteOne({ tenant_id: tenantId })
    return { ok: true, reverted_to: detectEnvProvider() ?? 'none' }
  })

  // POST /settings/llm/fix-endpoint — fix malformed Azure endpoint
  fastify.post('/settings/llm/fix-endpoint', async (req) => {
    const tenantId = req.authContext.tenant_id
    const doc = await col.findOne({ tenant_id: tenantId })
    if (!doc || !doc.azure_endpoint) {
      return { ok: false, message: 'No Azure endpoint found' }
    }
    
    // Fix the endpoint by removing /openai/v1/responses
    const fixedEndpoint = doc.azure_endpoint.replace(/\/openai\/v1\/responses.*$/, '').replace(/\/$/, '')
    log.info({ original: doc.azure_endpoint, fixed: fixedEndpoint }, 'Fixing Azure endpoint')
    
    await col.updateOne(
      { tenant_id: tenantId }, 
      { $set: { azure_endpoint: fixedEndpoint, updated_at: new Date().toISOString() } }
    )
    
    return { ok: true, original: doc.azure_endpoint, fixed: fixedEndpoint }
  })

  // ── Sandbox Mode Routes ───────────────────────────────────────────────────────

  // GET /settings/sandbox — get sandbox mode state
  fastify.get('/settings/sandbox', async (req) => {
    const tenantId = req.authContext.tenant_id
    const settings = await tenantSettings.findOne({ tenant_id: tenantId })
    const sandboxMode = settings?.sandbox_mode ?? false
    return { sandbox_mode: sandboxMode }
  })

  // PATCH /settings/sandbox — update sandbox mode
  fastify.patch<{
    Body: { enabled?: boolean }
  }>('/settings/sandbox', async (req) => {
    const tenantId = req.authContext.tenant_id
    const { enabled } = req.body
    
    await tenantSettings.updateOne(
      { tenant_id: tenantId },
      {
        $set: {
          sandbox_mode: enabled ?? false,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    )
    
    return { ok: true, sandbox_mode: enabled ?? false }
  })

  // POST /settings/llm/test-deployment — test common deployment names
  fastify.post('/settings/llm/test-deployment', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const doc = await col.findOne({ tenant_id: tenantId })
    if (!doc || !doc.azure_endpoint || !doc.api_key_enc) {
      return reply.status(400).send({ ok: false, message: 'Azure configuration incomplete' })
    }

    const apiKey = decrypt(doc.api_key_enc)
    const endpoint = doc.azure_endpoint.replace(/\/$/, '').replace(/\/openai.*$/, '')
    const apiVersion = doc.azure_api_version ?? '2024-10-21'

    // Gap A6: detect AI Foundry endpoints (.services.ai.azure.com) which use
    // the unified /openai/v1 API (model in body, not URL path) vs classic
    // Azure OpenAI (.openai.azure.com) which uses /openai/deployments/<name>.
    const isFoundry = !endpoint.endsWith('.openai.azure.com') && endpoint.includes('.ai.azure.com')
    const baseURL = isFoundry
      ? `${endpoint}/openai/v1`
      : null // classic path is per-deployment, built in the loop

    // Common deployment names to test
    const commonDeployments = ['gpt-4', 'gpt-4-turbo', 'gpt-35-turbo', 'gpt-4o', 'gpt-4o-mini']
    const results = []

    for (const deployment of commonDeployments) {
      try {
        const { default: OpenAI } = await import('openai')
        const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
          apiKey,
          baseURL: isFoundry ? baseURL! : `${endpoint}/openai/deployments/${deployment}`,
          defaultHeaders: { 'api-key': apiKey },
        }
        if (!isFoundry) {
          clientOpts.defaultQuery = { 'api-version': apiVersion }
        }
        const client = new OpenAI(clientOpts)

        // Test with a minimal request
        await client.chat.completions.create({
          model: deployment,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        })

        results.push({ deployment, status: 'success' })
        log.info({ deployment }, `Deployment test success: ${deployment}`)
      } catch (err) {
        results.push({ deployment, status: 'failed', error: (err as Error).message })
        log.info({ deployment, err: (err as Error).message }, `Deployment test failed: ${deployment}`)
      }
    }

    return { ok: true, results, endpoint_type: isFoundry ? 'foundry' : 'classic' }
  })

  // ── SSO Settings ───────────────────────────────────────────────────────────

  interface SsoSettingsDoc {
    tenant_id: string
    oidc_issuer?: string
    oidc_client_id?: string
    oidc_client_secret_enc?: string
    oidc_redirect_uri?: string
    saml_idp_url?: string
    saml_entity_id?: string
    saml_cert_enc?: string
    enabled: boolean
    updated_at: Date
  }

  fastify.get('/settings/sso', async (req) => {
    const tenant_id = req.authContext.tenant_id
    const col = db.collection<SsoSettingsDoc>('tenant_sso_settings')
    const doc = await col.findOne({ tenant_id })

    return {
      enabled: doc?.enabled ?? false,
      oidc: {
        issuer: doc?.oidc_issuer ?? '',
        client_id: doc?.oidc_client_id ?? '',
        client_secret_set: !!doc?.oidc_client_secret_enc,
        redirect_uri: doc?.oidc_redirect_uri ?? '',
      },
      saml: {
        idp_url: doc?.saml_idp_url ?? '',
        entity_id: doc?.saml_entity_id ?? '',
        cert_set: !!doc?.saml_cert_enc,
      },
    }
  })

  fastify.post('/settings/sso', async (req, _reply) => {
    const tenant_id = req.authContext.tenant_id
    const body = req.body as Record<string, unknown>

    const col = db.collection<SsoSettingsDoc>('tenant_sso_settings')

    const update: Partial<SsoSettingsDoc> = {
      enabled: body.enabled === true,
      updated_at: new Date(),
    }

    if (body.oidc && typeof body.oidc === 'object') {
      const oidc = body.oidc as Record<string, unknown>
      if (oidc.issuer) update.oidc_issuer = String(oidc.issuer)
      if (oidc.client_id) update.oidc_client_id = String(oidc.client_id)
      if (oidc.client_secret) update.oidc_client_secret_enc = encrypt(String(oidc.client_secret))
      if (oidc.redirect_uri) update.oidc_redirect_uri = String(oidc.redirect_uri)
    }

    if (body.saml && typeof body.saml === 'object') {
      const saml = body.saml as Record<string, unknown>
      if (saml.idp_url) update.saml_idp_url = String(saml.idp_url)
      if (saml.entity_id) update.saml_entity_id = String(saml.entity_id)
      if (saml.cert) update.saml_cert_enc = encrypt(String(saml.cert))
    }

    await col.updateOne({ tenant_id }, { $set: update }, { upsert: true })

    return { ok: true }
  })
}

// ── Helper to load decrypted key for a tenant (used by WorkflowEngine) ────────

export async function getTenantLlmConfig(db: Db, tenantId: string): Promise<{
  provider: string; model: string; apiKey?: string;
  azureEndpoint?: string; azureDeployment?: string; azureApiVersion?: string;
  ollamaBaseUrl?: string; temperature: number; maxTokens: number;
  tierModels?: Record<string, string>;
} | null> {
  const col = db.collection<LlmSettingsDoc>('tenant_llm_settings')
  const doc = await col.findOne({ tenant_id: tenantId })
  if (!doc) return null

  let apiKey: string | undefined
  if (doc.api_key_enc) {
    try {
      apiKey = decrypt(doc.api_key_enc)
    } catch {
      // SETTINGS_ENCRYPTION_KEY rotated, or the stored ciphertext predates
      // it — either way the key is unusable. Treat this the same as "no
      // provider configured" (the caller's existing, user-facing fallback)
      // rather than letting a crypto exception surface as an opaque 500.
      return null
    }
  }

  return {
    provider: doc.provider,
    model: doc.model,
    temperature: doc.temperature,
    maxTokens: doc.max_tokens,
    ...(apiKey ? { apiKey } : {}),
    ...(doc.azure_endpoint ? { azureEndpoint: doc.azure_endpoint } : {}),
    ...(doc.azure_deployment ? { azureDeployment: doc.azure_deployment } : {}),
    ...(doc.azure_api_version ? { azureApiVersion: doc.azure_api_version } : {}),
    ...(doc.ollama_base_url ? { ollamaBaseUrl: doc.ollama_base_url } : {}),
    ...(doc.tier_models ? { tierModels: doc.tier_models } : {}),
  }
}

function detectEnvProvider(): string | null {
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic'
  if (process.env['OPENAI_API_KEY']) return 'openai'
  if (process.env['GROQ_API_KEY']) return 'groq'
  if (process.env['AZURE_OPENAI_ENDPOINT']) return 'azure'
  if (process.env['OLLAMA_BASE_URL']) return 'ollama'
  return null
}
