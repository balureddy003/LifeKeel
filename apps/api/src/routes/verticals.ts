/**
 * Verticals API
 *
 * GET  /verticals            — list all shipped vertical manifests
 * GET  /verticals/active     — the tenant's active vertical (null if unset)
 * POST /verticals/:id/activate — set the tenant's active vertical
 *
 * This is the missing runtime seam identified in
 * docs/prd/shell-vertical-theming-ux-verdict.md: the Vertical manifest
 * (personas, theme, kpi_vocabulary) existed only as schema + content until
 * now — nothing served it to the frontend. See useVerticalLabels() in
 * apps/studio/src/lib/useVerticalLabels.ts for the consumer.
 *
 * Gap #31 (TRADING_ENGINE_GAPS.md): active_vertical had no onboarding UI to
 * set it, so it defaulted to null for most tenants — making the Research page
 * (and other vertical-specific nav items) invisible even for tenants whose
 * entire activity is in one vertical. GET /verticals/active now infers the
 * vertical from the tenant's active detectors when no explicit setting exists.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { loadVerticals, connectorRegistry } from '@kairos/workflows'
import type { Vertical } from '@kairos/specifications'
import { repoRoot } from '@kairos/platform'

/**
 * Infers the tenant's active vertical by checking which detectors have
 * produced insights for them, and matching those detector IDs against
 * vertical manifests' `detectors` lists. Returns the first vertical whose
 * detector list overlaps with the tenant's active detectors, or null if no
 * match is found.
 *
 * Used as a stopgap for gap #31: until onboarding UI exists to let the
 * tenant explicitly pick a vertical, this ensures the nav reflects their
 * actual usage. The explicit `active_vertical` setting (set via
 * POST /verticals/:id/activate) always takes precedence.
 */
export async function inferVerticalFromDetectors(db: Db, tenantId: string, root: string): Promise<string | null> {
  const verticals = loadVerticals(root)
  // Collect all detector IDs across all verticals, mapped back to their vertical.
  const detectorToVertical = new Map<string, string>()
  for (const v of verticals) {
    for (const detectorId of v.detectors) {
      detectorToVertical.set(detectorId, v.id)
    }
  }
  if (detectorToVertical.size === 0) return null

  // Query insights for distinct detector_ids this tenant has received.
  // Using distinct() is more efficient than fetching all insights.
  const insightsCol = db.collection('insights')
  const detectorIds = await insightsCol.distinct('detector_id', { tenant_id: tenantId })
  if (!detectorIds || detectorIds.length === 0) return null

  // Find the first vertical that has a detector matching one of the tenant's
  // active detectors. If multiple verticals match, prefer the one with the
  // most overlapping detectors.
  const verticalCounts = new Map<string, number>()
  for (const detectorId of detectorIds) {
    const verticalId = detectorToVertical.get(String(detectorId))
    if (verticalId) {
      verticalCounts.set(verticalId, (verticalCounts.get(verticalId) ?? 0) + 1)
    }
  }
  if (verticalCounts.size === 0) return null

  let bestVertical: string | null = null
  let bestCount = 0
  for (const [verticalId, count] of verticalCounts) {
    if (count > bestCount) {
      bestVertical = verticalId
      bestCount = count
    }
  }
  return bestVertical
}

/**
 * The tenant's active vertical id: explicit `tenant_settings.active_vertical`
 * setting if present, otherwise inferred from their detector activity (see
 * inferVerticalFromDetectors). Shared with other routes (e.g. attribution.ts)
 * that need to know the tenant's vertical to tailor copy/vocabulary.
 */
export async function resolveActiveVerticalId(db: Db, tenantId: string, root: string): Promise<string | null> {
  const settings = await db.collection('tenant_settings').findOne({ tenant_id: tenantId })
  const explicitId = settings?.['active_vertical'] as string | undefined
  return explicitId ?? (await inferVerticalFromDetectors(db, tenantId, root))
}

/**
 * Appends country-specific KPI vocabulary (kpi_vocabulary_by_country) to a
 * vertical's universal kpi_vocabulary, scoped to the countries the tenant has
 * actually signalled by connecting a connector tagged with that country
 * (e.g. trading-212 = GB, zerodha = IN). Never guesses: a tenant with no
 * connector connected yet (or one with no country tag) sees only the
 * universal list, so jurisdiction-specific terms never appear ungrounded.
 * Returns a new object — never mutates the loaded manifest.
 */
async function withResolvedKpiVocabulary(db: Db, tenantId: string, vertical: Vertical): Promise<Vertical> {
  const byCountry = vertical.kpi_vocabulary_by_country
  if (!byCountry || Object.keys(byCountry).length === 0) return vertical

  const credentials = await db.collection('connector_credentials').find({ tenant_id: tenantId }).toArray()
  const connectedCountries = new Set<string>()
  for (const c of credentials) {
    for (const country of connectorRegistry.get(String(c['connector_id']))?.supported_countries ?? []) {
      connectedCountries.add(country)
    }
  }
  if (connectedCountries.size === 0) return vertical

  const extra = Object.entries(byCountry)
    .filter(([country]) => connectedCountries.has(country))
    .flatMap(([, terms]) => terms)
  if (extra.length === 0) return vertical

  return { ...vertical, kpi_vocabulary: [...vertical.kpi_vocabulary, ...extra] }
}

export async function registerVerticalRoutes(app: FastifyInstance, db?: Db): Promise<void> {
  const root = repoRoot()

  /** GET /verticals — list all shipped vertical manifests. */
  app.get('/verticals', async () => {
    return { verticals: loadVerticals(root) }
  })

  /** GET /verticals/active — the tenant's active vertical manifest, or null. */
  app.get('/verticals/active', async (req) => {
    const { tenant_id } = req.authContext
    if (!db) return { vertical: null }

    const settings = await db.collection('tenant_settings').findOne({ tenant_id })
    const explicitId = settings?.['active_vertical'] as string | undefined

    // Gap #31: if no explicit active_vertical is set, infer it from the
    // tenant's active detectors. This ensures the nav reflects actual usage
    // even when onboarding never set the vertical explicitly.
    const activeId = await resolveActiveVerticalId(db, tenant_id, root)
    if (!activeId) return { vertical: null }

    const found = loadVerticals(root).find((v) => v.id === activeId) ?? null
    const vertical = found ? await withResolvedKpiVocabulary(db, tenant_id, found) : null
    return { vertical, inferred: !explicitId }
  })

  /** POST /verticals/:id/activate — set the tenant's active vertical. */
  app.post<{ Params: { id: string } }>('/verticals/:id/activate', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id } = req.params

    const vertical = loadVerticals(root).find((v) => v.id === id)
    if (!vertical) return reply.status(404).send({ error: `Vertical not found: ${id}` })

    if (!db) return reply.status(503).send({ error: 'Database connection required' })

    await db.collection('tenant_settings').updateOne(
      { tenant_id },
      { $set: { active_vertical: id, updated_at: new Date() } },
      { upsert: true },
    )

    return { success: true, active_vertical: id }
  })
}
