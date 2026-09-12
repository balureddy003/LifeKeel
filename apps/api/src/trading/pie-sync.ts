/**
 * Trading 212 Pie sync — mirrors the strategy's target allocation as a
 * Trading 212 Pie.
 *
 * Trading 212 Pies are auto-rebalancing portfolios. By syncing the momentum
 * strategy's target allocation to a Pie, the user gets:
 *   1. A visual representation of the strategy in the Trading 212 app
 *   2. Automatic rebalancing by Trading 212 (in addition to our own)
 *   3. The ability to share the Pie via a public URL
 *
 * The Pie API is deprecated but still operational. We create a Pie named
 * "Kairos Momentum Strategy" (or update it if it already exists) with the
 * current target weights from the strategy's recommendations.
 */

import { ConnectorActionExecutor } from '@kairos/workflows'
import { createLogger } from '@kairos/platform'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@kairos/platform'

const log = createLogger({ service: 'pie-sync', version: process.env['npm_package_version'] ?? '0.0.0' })

const KAIROS_PIE_NAME = 'Kairos Momentum Strategy'

interface PieInstrument {
  ticker: string
  expectedShare: number // 0-1
}

interface PieResponse {
  id?: number
  settings?: {
    id?: number
    name?: string
  }
  instruments?: Array<{
    ticker: string
    expectedShare: number
    currentShare: number
    ownedQuantity: number
  }>
}

/**
 * Find the Kairos-managed Pie by name. Returns the pie id if found.
 */
async function findKairosPie(
  executor: ConnectorActionExecutor,
  tenantId: string,
): Promise<number | undefined> {
  const result = await executor.execute(tenantId, 'trading-212', 'get_pies', {})
  if (!result.ok || !Array.isArray(result.body)) return undefined

  const pies = result.body as PieResponse[]
  const kairosPie = pies.find((p) => p.settings?.name === KAIROS_PIE_NAME)
  return kairosPie?.settings?.id ?? kairosPie?.id
}

/**
 * Sync the strategy's target allocation to a Trading 212 Pie.
 *
 * If a Kairos-managed Pie already exists, it's updated with the new target
 * weights. If not, a new Pie is created.
 *
 * @param db MongoDB database
 * @param tenantId Tenant id
 * @param targetWeights Map of ticker → target weight (0-1)
 * @returns The pie id and whether it was created or updated
 */
export async function syncPieAllocation(
  db: Db,
  tenantId: string,
  targetWeights: Map<string, number>,
): Promise<{ pieId: number | undefined; action: 'created' | 'updated' | 'unchanged'; instruments: PieInstrument[] }> {
  const executor = new ConnectorActionExecutor(db)

  // Build the instruments array for the Pie API
  const instruments: PieInstrument[] = []
  for (const [ticker, weight] of targetWeights) {
    if (weight > 0) {
      instruments.push({ ticker, expectedShare: Math.round(weight * 10000) / 10000 })
    }
  }

  if (instruments.length === 0) {
    log.warn({ tenant_id: tenantId }, 'Pie sync skipped — no positions in target allocation')
    return { pieId: undefined, action: 'unchanged', instruments: [] }
  }

  // Check if the Kairos Pie already exists
  const existingPieId = await findKairosPie(executor, tenantId)

  if (existingPieId !== undefined) {
    // Update the existing Pie
    const result = await executor.execute(tenantId, 'trading-212', 'update_pie', {
      id: String(existingPieId),
      name: KAIROS_PIE_NAME,
      instruments: JSON.stringify(instruments),
    })

    if (!result.ok) {
      log.error({ tenant_id: tenantId, pie_id: existingPieId, status: result.status, body: result.body }, 'Failed to update Kairos Pie')
      throw new Error(`Failed to update Pie: ${result.status} ${JSON.stringify(result.body)}`)
    }

    log.info({ tenant_id: tenantId, pie_id: existingPieId, instruments: instruments.length }, 'Kairos Pie updated')
    return { pieId: existingPieId, action: 'updated', instruments }
  }

  // Create a new Pie
  const result = await executor.execute(tenantId, 'trading-212', 'create_pie', {
    name: KAIROS_PIE_NAME,
    instruments: JSON.stringify(instruments),
  })

  if (!result.ok) {
    log.error({ tenant_id: tenantId, status: result.status, body: result.body }, 'Failed to create Kairos Pie')
    throw new Error(`Failed to create Pie: ${result.status} ${JSON.stringify(result.body)}`)
  }

  const newPieId = (result.body as PieResponse)?.id ?? (result.body as PieResponse)?.settings?.id
  log.info({ tenant_id: tenantId, pie_id: newPieId, instruments: instruments.length }, 'Kairos Pie created')
  return { pieId: newPieId, action: 'created', instruments }
}

/**
 * Fetch the current Kairos Pie and its instrument allocation.
 */
export async function getKairosPie(
  db: Db,
  tenantId: string,
): Promise<{ pieId: number | undefined; instruments: PieInstrument[]; name: string | undefined }> {
  const executor = new ConnectorActionExecutor(db)
  const pieId = await findKairosPie(executor, tenantId)

  if (pieId === undefined) {
    return { pieId: undefined, instruments: [], name: undefined }
  }

  const result = await executor.execute(tenantId, 'trading-212', 'get_pie', { id: String(pieId) })
  if (!result.ok) {
    log.error({ tenant_id: tenantId, pie_id: pieId, status: result.status }, 'Failed to fetch Kairos Pie details')
    return { pieId, instruments: [], name: KAIROS_PIE_NAME }
  }

  const pie = result.body as PieResponse
  const instruments = (pie.instruments ?? []).map((i) => ({
    ticker: i.ticker,
    expectedShare: i.expectedShare,
  }))

  return { pieId, instruments, name: pie.settings?.name ?? KAIROS_PIE_NAME }
}

/**
 * Persist the Kairos Pie id in tenant_settings so we can find it quickly
 * without scanning all pies on every sync.
 */
export async function savePieId(db: Db, tenantId: string, pieId: number): Promise<void> {
  await getTenantCollection(db, 'tenant_settings', tenantId).updateOne(
    { tenant_id: tenantId, key: 'kairos_pie' },
    { $set: { tenant_id: tenantId, key: 'kairos_pie', value: { pie_id: pieId, name: KAIROS_PIE_NAME }, updated_at: new Date() } },
    { upsert: true },
  )
}
