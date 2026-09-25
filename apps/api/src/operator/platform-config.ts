/**
 * Platform configuration — a small set of typed global switches, not a
 * generic key-value store. Each flag has a single documented enforcement
 * point:
 *
 *  - maintenance_mode   → auth middleware rejects non-operator requests 503
 *  - signups_enabled    → /auth/signup rejects new account creation 503
 *  - marketing_paused   → marketing publish path refuses to send
 *
 * Values are cached briefly in-process so the auth middleware doesn't add
 * a Mongo round-trip per request; writes go through the operator route,
 * which appends a history record and busts the cache.
 */

import type { Db } from 'mongodb'

export interface PlatformConfig {
  maintenance_mode: boolean
  signups_enabled: boolean
  marketing_paused: boolean
}

export const CONFIG_DOC_KEY = 'global'
const DEFAULTS: PlatformConfig = { maintenance_mode: false, signups_enabled: true, marketing_paused: false }
const CACHE_TTL_MS = 10_000

let cache: { config: PlatformConfig; at: number } | null = null

export async function getPlatformConfig(db: Db): Promise<PlatformConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.config
  const doc = await db.collection('platform_config').findOne({ key: CONFIG_DOC_KEY })
  const config: PlatformConfig = {
    maintenance_mode: doc?.['maintenance_mode'] === true,
    signups_enabled: doc?.['signups_enabled'] !== false,
    marketing_paused: doc?.['marketing_paused'] === true,
  }
  cache = { config, at: Date.now() }
  return config
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
}

export function registerPublicStatusRoute(
  app: { get: (path: string, handler: () => Promise<PublicStatus>) => unknown },
  getDb: () => Db | undefined,
): void {
  app.get('/status', async (): Promise<PublicStatus> => {
    const db = getDb()
    if (!db) return { maintenance_mode: false, signups_enabled: true }
    const config = await getPlatformConfig(db)
    return { maintenance_mode: config.maintenance_mode, signups_enabled: config.signups_enabled }
  })
}
