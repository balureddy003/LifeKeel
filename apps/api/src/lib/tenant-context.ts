/**
 * Tenant context helpers — read country, currency, and locale from the
 * tenant document with backward-compatible defaults.
 *
 * Existing tenants created before the country field was added have no
 * `country` or `locale` field — they fall back to GB/GBP/en-GB so they
 * behave exactly as before.
 */

import type { Db } from 'mongodb'
import { getCurrencyForCountry, getLocaleForCountry, getTenantCollection } from '@kairos/platform'
import type { Currency } from '@kairos/platform'

/** Cache tenant country/currency lookups in-process for 60s to avoid
 * a MongoDB round-trip on every request that needs the currency. */
interface TenantGeoCache {
  country: string
  currency: Currency
  locale: string
  fetchedAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, TenantGeoCache>()

/** Read the tenant's country, currency, and locale from the tenants
 * collection. Falls back to GB/GBP/en-GB for tenants without a country
 * field (created before multi-country support). */
export async function getTenantGeo(db: Db, tenantId: string): Promise<TenantGeoCache> {
  const cached = cache.get(tenantId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached

  const tenant = await getTenantCollection<Record<string, unknown>>(db, 'tenants', tenantId).findOne(
    {},
    { projection: { country: 1, locale: 1, 'billing.currency': 1 } },
  ) as { country?: string; locale?: string; billing?: { currency?: string } } | null

  const country = tenant?.country ?? 'GB'
  const currency = (tenant?.billing?.currency as Currency) ?? getCurrencyForCountry(country)
  const locale = tenant?.locale ?? getLocaleForCountry(country)

  const entry: TenantGeoCache = { country, currency, locale, fetchedAt: Date.now() }
  cache.set(tenantId, entry)
  return entry
}

/** Get just the tenant's currency (with caching). */
export async function getTenantCurrency(db: Db, tenantId: string): Promise<Currency> {
  return (await getTenantGeo(db, tenantId)).currency
}

/** Get just the tenant's locale (with caching). */
export async function getTenantLocale(db: Db, tenantId: string): Promise<string> {
  return (await getTenantGeo(db, tenantId)).locale
}

/** Get just the tenant's country code (with caching). */
export async function getTenantCountry(db: Db, tenantId: string): Promise<string> {
  return (await getTenantGeo(db, tenantId)).country
}

/** Invalidate the cache for a tenant (call when country/currency is updated). */
export function invalidateTenantGeoCache(tenantId: string): void {
  cache.delete(tenantId)
}
