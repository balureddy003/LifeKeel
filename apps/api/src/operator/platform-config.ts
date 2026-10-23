/**
 * Platform configuration — a small set of typed global switches, not a
 * generic key-value store. Each flag has a single documented enforcement
 * point:
 *
 *  - maintenance_mode   → auth middleware rejects non-operator requests 503
 *  - signups_enabled    → /auth/signup rejects new account creation 503
 *  - marketing_paused   → marketing publish path refuses to send
 *  - ai_disabled_tasks  → the AI task gateway refuses these task_ids with
 *                        TaskDisabledError → callers' honest fallback path
 *                        (PRD-217 operator switch, audited via the operator
 *                        route; never written directly)
 *  - llm_provider_override → the LLM router's provider pick — the runtime
 *                        equivalent of LIFEKEEL_LLM_PROVIDER, switchable
 *                        without a redeploy. Still bounded by the processor
 *                        registry: a provider named here that the task may
 *                        not use fails the processor check, it does not
 *                        silently reroute.
 *
 * Values are cached briefly in-process so the auth middleware doesn't add
 * a Mongo round-trip per request; writes go through the operator route,
 * which appends a history record and busts the cache.
 */

import type { Db } from 'mongodb'
import type { LlmProvider } from '@lifekeel/platform'

export interface MaintenanceWindow {
  starts_at: string
  ends_at: string
  message: string
}

export interface PlatformConfig {
  maintenance_mode: boolean
  signups_enabled: boolean
  marketing_paused: boolean
  /** Kill switch for the autopilot sweep — nothing (shadow or live) runs while
   *  true. Human-set only: configuration.update is never autonomous. */
  autopilot_paused: boolean
  /** Scheduled maintenance notice — surfaced publicly via /status so the
   *  product can warn users before maintenance_mode actually engages. */
  maintenance_window: MaintenanceWindow | null
  /** AI task_ids the gateway refuses (PRD-217 disable→fallback switch).
   *  Written only through the audited operator route. */
  ai_disabled_tasks: string[]
  /** Operator-selected hosted provider (runtime LIFEKEEL_LLM_PROVIDER).
   *  null = router decides from model name / configured credentials. */
  llm_provider_override: LlmProvider | null
}

/** Providers a runtime override may name — must stay inside LlmProvider. */
const VALID_PROVIDER_OVERRIDES = new Set<string>([
  'anthropic',
  'openai',
  'azure',
  'vertex',
  'ollama',
  'groq',
  'xai',
])

export const CONFIG_DOC_KEY = 'global'
const DEFAULTS: PlatformConfig = {
  maintenance_mode: false,
  signups_enabled: true,
  marketing_paused: false,
  autopilot_paused: false,
  maintenance_window: null,
  ai_disabled_tasks: [],
  llm_provider_override: null,
}
const CACHE_TTL_MS = 10_000

let cache: { config: PlatformConfig; at: number } | null = null
/**
 * The last override read — warmed by every getPlatformConfig call so
 * synchronous resolution sites (the router's resolveProvider,
 * resolveServingProcessor) can read it without a Mongo round-trip.
 */
let lastLlmProviderOverride: LlmProvider | null = null

function parseWindow(raw: unknown): MaintenanceWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const starts = typeof w['starts_at'] === 'string' ? w['starts_at'] : ''
  const ends = typeof w['ends_at'] === 'string' ? w['ends_at'] : ''
  const message = typeof w['message'] === 'string' ? w['message'] : ''
  if (!starts || !ends || !message) return null
  return { starts_at: starts, ends_at: ends, message }
}

export async function getPlatformConfig(db: Db): Promise<PlatformConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.config
  const doc = await db.collection('platform_config').findOne({ key: CONFIG_DOC_KEY })
  const config: PlatformConfig = {
    maintenance_mode: doc?.['maintenance_mode'] === true,
    signups_enabled: doc?.['signups_enabled'] !== false,
    marketing_paused: doc?.['marketing_paused'] === true,
    autopilot_paused: doc?.['autopilot_paused'] === true,
    maintenance_window: parseWindow(doc?.['maintenance_window']),
    ai_disabled_tasks: Array.isArray(doc?.['ai_disabled_tasks'])
      ? (doc['ai_disabled_tasks'] as unknown[]).filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        )
      : [],
    llm_provider_override:
      typeof doc?.['llm_provider_override'] === 'string' &&
      VALID_PROVIDER_OVERRIDES.has(doc['llm_provider_override'] as string)
        ? (doc['llm_provider_override'] as LlmProvider)
        : null,
  }
  lastLlmProviderOverride = config.llm_provider_override
  cache = { config, at: Date.now() }
  return config
}

/**
 * The operator's runtime provider pick, synchronously — warmed by every
 * getPlatformConfig call (the gateway already makes one per governed call
 * for ai_disabled_tasks, so the value is at most ~10s stale). Returns null
 * until the first config read.
 */
export function currentLlmProviderOverride(): LlmProvider | null {
  return lastLlmProviderOverride
}

export function invalidatePlatformConfigCache(): void {
  cache = null
}

/**
 * Public product status for the frontend — mounted at GET /status in
 * server.ts. Deliberately separate from operator configuration reads: it
 * exposes only the two flags a client legitimately needs (maintenance_mode
 * for the outage banner, signups_enabled for the signup page), never the
 * full config or history. Must stay reachable during maintenance — it's in
 * the open-routes list, which returns before the 503 check. getDb is a
 * thunk because routes register before connectMongo assigns workflowDb;
 * an absent db means "API still booting" → report defaults, not an outage.
 */
export interface PublicStatus {
  maintenance_mode: boolean
  signups_enabled: boolean
  /** Present only while the window is upcoming or in progress — past
   *  windows are dropped so stale banners can't linger. */
  maintenance_window?: MaintenanceWindow
}

export function registerPublicStatusRoute(
  app: { get: (path: string, handler: () => Promise<PublicStatus>) => unknown },
  getDb: () => Db | undefined,
): void {
  app.get('/status', async (): Promise<PublicStatus> => {
    const db = getDb()
    if (!db) return { maintenance_mode: false, signups_enabled: true }
    const config = await getPlatformConfig(db)
    const status: PublicStatus = {
      maintenance_mode: config.maintenance_mode,
      signups_enabled: config.signups_enabled,
    }
    const window = config.maintenance_window
    if (window && new Date(window.ends_at).getTime() > Date.now())
      status.maintenance_window = window
    return status
  })
}
