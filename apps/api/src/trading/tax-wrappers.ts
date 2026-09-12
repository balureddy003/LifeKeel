/**
 * Tax wrapper configuration — country-specific tax-advantaged investment
 * wrappers and their annual allowance limits.
 *
 * Each country has its own tax-advantaged wrapper(s) with different annual
 * contribution limits. This module maps country codes to their wrapper
 * configuration so the portfolio routes can serve the correct limit without
 * hardcoding UK-specific ISA values.
 *
 * To add a new country's tax wrapper, add an entry to TAX_WRAPPER_CONFIGS.
 */

export interface TaxWrapperConfig {
  /** Wrapper type identifier (e.g. 'isa', 'elss', 'sip') */
  type: string
  /** Human-readable name for display */
  name: string
  /** Annual contribution limit in minor units of the country's currency */
  limitMinor: number
  /** ISO 4217 currency code */
  currency: string
  /** Account type value used in portfolio signals (matches connector field mappings) */
  accountType: string
  /** The taxable (non-advantaged) account type for comparison */
  taxableAccountType: string
  /** Description shown in the UI */
  description: string
}

/** Country → tax wrapper configuration. */
const TAX_WRAPPER_CONFIGS: Record<string, TaxWrapperConfig> = {
  GB: {
    type: 'isa',
    name: 'ISA',
    limitMinor: 2_000_000,  // £20,000 in pence
    currency: 'GBP',
    accountType: 'isa',
    taxableAccountType: 'invest',
    description: 'Individual Savings Account — tax-free wrapper for investments',
  },
  IN: {
    type: 'elss',
    name: 'ELSS (§80C)',
    limitMinor: 15_00_000,  // ₹1,50,000 in paise (₹1.5L under §80C)
    currency: 'INR',
    accountType: 'cnc',     // Kite's CNC (Cash & Carry) = delivery/demat
    taxableAccountType: 'cnc',
    description: 'Equity Linked Savings Scheme — tax-saving under §80C (₹1.5L limit)',
  },
  US: {
    type: 'ira',
    name: 'IRA',
    limitMinor: 7_000_000,  // $7,000 in cents (2024 limit, under-50)
    currency: 'USD',
    accountType: 'ira',
    taxableAccountType: 'invest',
    description: 'Individual Retirement Account — tax-advantaged retirement savings',
  },
}

/** Fallback for countries without a known tax wrapper.
 *  Returns null — the tenant can still trade, just no wrapper tracking. */
const DEFAULT_CONFIG: TaxWrapperConfig | null = null

/** Get the tax wrapper configuration for a country code.
 * Returns null for countries without a known tax-advantaged wrapper. */
export function getTaxWrapperConfig(country: string | undefined | null): TaxWrapperConfig | null {
  if (!country) return TAX_WRAPPER_CONFIGS['GB'] ?? DEFAULT_CONFIG  // backward compat
  return TAX_WRAPPER_CONFIGS[country.toUpperCase()] ?? DEFAULT_CONFIG
}

/** Get the annual allowance limit in minor units for a country's tax wrapper.
 * Returns null if the country has no known tax wrapper. */
export function getTaxWrapperLimit(country: string | undefined | null): number | null {
  const config = getTaxWrapperConfig(country)
  return config?.limitMinor ?? null
}

/** Get the tax-advantaged account type for a country (e.g. 'isa', 'cnc').
 * Returns null if the country has no known tax wrapper. */
export function getTaxAdvantagedAccountType(country: string | undefined | null): string | null {
  const config = getTaxWrapperConfig(country)
  return config?.accountType ?? null
}

/** Get the taxable account type for a country (e.g. 'invest', 'cnc').
 * Falls back to 'invest' for unknown countries (backward compatible). */
export function getTaxableAccountType(country: string | undefined | null): string {
  const config = getTaxWrapperConfig(country)
  return config?.taxableAccountType ?? 'invest'
}

/** Get the settings key for storing tax wrapper allowance data.
 * Uses 'isa_allowance' for GB (backward compatible with existing data),
 * 'tax_wrapper_allowance' for all other countries. */
export function getTaxWrapperSettingsKey(country: string | undefined | null): string {
  if (!country || country.toUpperCase() === 'GB') return 'isa_allowance'
  return 'tax_wrapper_allowance'
}
