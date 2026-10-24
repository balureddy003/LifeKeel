/**
 * lifekeel-scan-worker: the document scan service (CLOUDFLARE_INTEGRATION.md §7.11).
 *
 * Same image as the API, different entrypoint (`node dist/scan-worker.js`).
 * Deploy as its own Cloud Run service with min-instances >= 1, CPU always
 * allocated, one scan per instance, its own service account holding the
 * `r2-scan` credential (the API's account must not), and VPC egress limited
 * to R2, ClamAV, MongoDB and Redis.
 *
 * Loop: wait on the Redis wake-up list (5 s timeout), then claim due rows
 * from MongoDB until none are left. Every 60 s the reconciler runs; nightly
 * the orphan sweep and quota reconcile run. Redis is only a wake-up: with it
 * down, the reconciler tick alone still drains the queue.
 *
 * GET /health answers Cloud Run's probe and reports the last loop tick.
 */
// Not './env.js': that validates the API's full configuration (JWT secret,
// LLM keys), none of which this service may hold.
import dotenv from 'dotenv'
import http from 'node:http'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { createLogger } from '@lifekeel/platform'
import { closeDb, getDb } from './db.js'
import { initAuditLogger } from './audit/audit-log.js'
import { deploymentConfig } from './config/deployment.js'
import { claimNext, WAKE_KEY } from './documents/pipeline.js'
import { processScanJob } from './documents/scan-job.js'
import { reconcileOnce, sweepOrphanObjects } from './documents/reconciler.js'
import { reconcileQuotas, ensureQuotaIndexes } from './documents/quota.js'
import { ensureDeletionIndexes } from './documents/deletion.js'
import { assertDocumentsSchemaFloor } from './documents/storage.js'
import { objectStore, r2Settings } from './documents/r2.js'
import { clamdDefinitionsAgeSeconds, scanRequired } from './extraction/scan.js'
import { setClamavDefinitionsAge } from './observability/security-metrics.js'
import { renderMetrics, metricsScrapeAuthorized } from './routes/metrics.js'
import { dropEmptyEnv } from './env-helpers.js'

dotenv.config({ path: new URL('../../../.env', import.meta.url).pathname })
dropEmptyEnv()

const log = createLogger({
  service: 'scan-worker',
  version: process.env['npm_package_version'] ?? '0.0.0',
})
const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
const RECONCILE_MS = 60_000
const DEFINITIONS_MAX_AGE_S = 48 * 3600

function bootChecks(): void {
  const s = r2Settings()
  const problems: string[] = []
  if (!s) problems.push('R2_ACCOUNT_ID or R2_ENDPOINT is required')
  else if (!s.keys.scan)
    problems.push('R2_SCAN_ACCESS_KEY_ID / R2_SCAN_SECRET_ACCESS_KEY are required')
  if (deploymentConfig.mode !== 'dev' && scanRequired() && !process.env['CLAMD_HOST'])
    problems.push('CLAMD_HOST is required (MALWARE_SCAN_REQUIRED defaults true outside dev)')
  if (problems.length) {
    log.error({ problems }, 'FATAL: scan worker misconfigured')
    process.exit(1)
  }
}

let lastTick = Date.now()
let definitionsAge: number | null = null
let stopping = false

async function drain(): Promise<number> {
  const db = await getDb()
  let n = 0
  while (!stopping) {
    const row = await claimNext(db, WORKER_ID)
    if (!row) break
    const outcome = await processScanJob(db, row, {
      definitionsStale: () =>
        process.env['CLAMD_HOST'] !== undefined &&
        definitionsAge !== null &&
        definitionsAge > DEFINITIONS_MAX_AGE_S,
    })
    log.info({ documentId: row.id, outcome, attempt: row.scan_job.attempt }, 'Scan job finished')
    n++
  }
  return n
}

async function reconcileTick(): Promise<void> {
  const db = await getDb()
  definitionsAge = await clamdDefinitionsAgeSeconds()
  if (definitionsAge !== null) setClamavDefinitionsAge(definitionsAge)
  await reconcileOnce(db)
}

let lastNightly = 0
async function nightly(): Promise<void> {
  if (Date.now() - lastNightly < 24 * 3600_000) return
  lastNightly = Date.now()
  const db = await getDb()
  const orphans = await sweepOrphanObjects(db, objectStore('scan'))
  const quotas = await reconcileQuotas(db)
  log.info({ ...orphans, ...quotas }, 'Nightly document consistency pass')
}

async function main(): Promise<void> {
  bootChecks()
  const db = await getDb()
  await assertDocumentsSchemaFloor(db)
  await ensureQuotaIndexes(db)
  await ensureDeletionIndexes(db)
  initAuditLogger(db, deploymentConfig.auditLogEnabled)

  const port = Number(process.env['PORT'] ?? 8080)
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      const healthy = Date.now() - lastTick < 3 * RECONCILE_MS
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: healthy ? 'ok' : 'stalled' }))
      return
    }
    if (
      req.url === '/metrics' &&
      metricsScrapeAuthorized(req.headers.authorization, process.env['METRICS_SCRAPE_TOKEN'])
    ) {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
      res.end(await renderMetrics())
      return
    }
    res.writeHead(404).end()
  })
  server.listen(port, () => log.info({ port, worker: WORKER_ID }, 'Scan worker listening'))

  const redisUrl = process.env['REDIS_URL']
  const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null }) : null
  redis?.on('error', (err) => log.warn({ err: err.message }, 'Redis wake-up channel error'))

  const shutdown = async () => {
    stopping = true
    server.close()
    redis?.disconnect()
    await closeDb().catch(() => {})
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  let nextReconcile = 0
  while (!stopping) {
    lastTick = Date.now()
    try {
      if (Date.now() >= nextReconcile) {
        nextReconcile = Date.now() + RECONCILE_MS
        await reconcileTick()
        await nightly()
      }
      await drain()
      if (redis) await redis.brpop(WAKE_KEY, 5).catch(() => null)
      else await new Promise((r) => setTimeout(r, 5000))
    } catch (err) {
      log.error({ err }, 'Scan worker loop error')
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

main().catch((err) => {
  log.error({ err }, 'FATAL: scan worker crashed')
  process.exit(1)
})
