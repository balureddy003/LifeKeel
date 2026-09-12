/**
 * Country configuration — maps ISO 3166-1 alpha-2 country codes to their
 * default currency (ISO 4217), locale (BCP 47), and timezone (IANA).
 *
 * Used at tenant signup to derive billing currency and locale from the
 * selected country, and throughout the app to replace hardcoded GBP/en-GB
 * defaults with tenant-specific values.
 *
 * To add a new country, add an entry here — no other code needs to change
 * for the currency/locale/timezone defaults to propagate.
 */

import type { Currency } from './money.js'

export interface CountryConfig {
  /** ISO 4217 currency code */
  currency: Currency
  /** BCP 47 locale tag for number/date formatting */
  locale: string
  /** IANA timezone identifier */
  timezone: string
  /** Human-readable country name */
  name: string
}

/** Country code (ISO 3166-1 alpha-2, uppercase) */
export type CountryCode = string

const COUNTRY_CONFIG: Record<string, CountryConfig> = {
  GB: { currency: 'GBP', locale: 'en-GB', timezone: 'Europe/London', name: 'United Kingdom' },
  US: { currency: 'USD', locale: 'en-US', timezone: 'America/New_York', name: 'United States' },
  IN: { currency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', name: 'India' },
  DE: { currency: 'EUR', locale: 'de-DE', timezone: 'Europe/Berlin', name: 'Germany' },
  FR: { currency: 'EUR', locale: 'fr-FR', timezone: 'Europe/Paris', name: 'France' },
  ES: { currency: 'EUR', locale: 'es-ES', timezone: 'Europe/Madrid', name: 'Spain' },
  IT: { currency: 'EUR', locale: 'it-IT', timezone: 'Europe/Rome', name: 'Italy' },
  NL: { currency: 'EUR', locale: 'nl-NL', timezone: 'Europe/Amsterdam', name: 'Netherlands' },
  IE: { currency: 'EUR', locale: 'en-IE', timezone: 'Europe/Dublin', name: 'Ireland' },
  AU: { currency: 'AUD', locale: 'en-AU', timezone: 'Australia/Sydney', name: 'Australia' },
  CA: { currency: 'CAD', locale: 'en-CA', timezone: 'America/Toronto', name: 'Canada' },
  SG: { currency: 'SGD', locale: 'en-SG', timezone: 'Asia/Singapore', name: 'Singapore' },
  AE: { currency: 'AED', locale: 'en-AE', timezone: 'Asia/Dubai', name: 'United Arab Emirates' },
  ZA: { currency: 'ZAR', locale: 'en-ZA', timezone: 'Africa/Johannesburg', name: 'South Africa' },
  NZ: { currency: 'NZD', locale: 'en-NZ', timezone: 'Pacific/Auckland', name: 'New Zealand' },
  CH: { currency: 'CHF', locale: 'de-CH', timezone: 'Europe/Zurich', name: 'Switzerland' },
  JP: { currency: 'JPY', locale: 'ja-JP', timezone: 'Asia/Tokyo', name: 'Japan' },
  BR: { currency: 'BRL', locale: 'pt-BR', timezone: 'America/Sao_Paulo', name: 'Brazil' },
  MX: { currency: 'MXN', locale: 'es-MX', timezone: 'America/Mexico_City', name: 'Mexico' },
}

/** Fallback config for countries not in the map — defaults to GBP/en-GB
 * (backward compatible with existing tenants that have no country set). */
const DEFAULT_CONFIG: CountryConfig = {
  currency: 'GBP',
  locale: 'en-GB',
  timezone: 'Europe/London',
  name: 'Unknown',
}

/** Get country config for a country code. Falls back to GBP/en-GB for
 * unknown countries so existing tenants without a country field behave
 * exactly as before. */
export function getCountryConfig(country: string | undefined | null): CountryConfig {
  if (!country) return DEFAULT_CONFIG
  return COUNTRY_CONFIG[country.toUpperCase()] ?? DEFAULT_CONFIG
}

/** Get the default currency for a country code */
export function getCurrencyForCountry(country: string | undefined | null): Currency {
  return getCountryConfig(country).currency
}

/** Get the default locale for a country code */
export function getLocaleForCountry(country: string | undefined | null): string {
  return getCountryConfig(country).locale
}

/** Get the default timezone for a country code */
export function getTimezoneForCountry(country: string | undefined | null): string {
  return getCountryConfig(country).timezone
}

/** List all supported country codes (for onboarding UI dropdown) */
export function listSupportedCountries(): Array<{ code: string; name: string; currency: Currency }> {
  return Object.entries(COUNTRY_CONFIG)
    .map(([code, config]) => ({ code, name: config.name, currency: config.currency }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Validate that a country code is supported */
export function isValidCountryCode(country: string | undefined | null): boolean {
  if (!country) return false
  return country.toUpperCase() in COUNTRY_CONFIG
}
