/**
 * Money Utilities — Pattern: Decimal Money Pipeline
 *
 * Rule: NEVER use float for monetary values.
 * Store as integer minor units (pence/cents). Display as decimal.
 *
 * BigInt-based arithmetic for exact integer operations.
 * String-based decimal for display — never loses precision.
 */

export type MinorUnits = number & { readonly __brand: 'MinorUnits' }
export type Currency = 'GBP' | 'USD' | 'EUR' | 'AUD' | 'CAD' | 'INR' | 'SGD' | 'AED' | 'ZAR' | 'NZD' | 'CHF' | 'JPY' | 'BRL' | 'MXN' | string

/** Convert a decimal string/number to minor units (integer pence/cents) */
export function toMinorUnits(amount: string | number, decimals = 2): MinorUnits {
  const str = typeof amount === 'number' ? amount.toFixed(decimals + 2) : amount
  const [intPart = '0', fracPart = ''] = str.split('.')
  const fraction = fracPart.padEnd(decimals, '0').slice(0, decimals)
  const result = parseInt(intPart, 10) * Math.pow(10, decimals) + parseInt(fraction || '0', 10)
  if (!isFinite(result)) throw new Error(`Cannot convert "${amount}" to minor units`)
  return result as MinorUnits
}

/** Convert minor units to a display string — never use for arithmetic */
export function fromMinorUnits(minorUnits: number, decimals = 2): string {
  const negative = minorUnits < 0
  const abs = Math.abs(minorUnits)
  const divisor = Math.pow(10, decimals)
  const intPart = Math.floor(abs / divisor)
  const fracPart = String(abs % divisor).padStart(decimals, '0')
  return `${negative ? '-' : ''}${intPart}.${fracPart}`
}

/** Format for display with currency symbol */
export function formatMoney(minorUnits: number, currency: Currency = 'GBP'): string {
  const symbols: Record<string, string> = {
    GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', INR: '₹', SGD: 'S$', AED: 'د.إ', ZAR: 'R', NZD: 'NZ$', CHF: 'Fr', JPY: '¥', BRL: 'R$', MXN: 'Mex$',
  }
  const symbol = symbols[currency] ?? currency
  // Every detector-generated insight/playbook/notification renders money
  // through this function (via @lifekeel/engine's template interpolation) —
  // without a grouping separator, a real figure like a life-cover shortfall
  // reads as "£200000.00", genuinely harder to parse at a glance than
  // "£200,000.00" and working against this app's any-age-accessible goal.
  const major = (minorUnits / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${symbol}${major}`
}

export interface MoneyDisplay {
  formatted: string
  compact: string
  symbol: string
}

export function formatMoneyDisplay(minorUnits: number, currency: Currency = 'GBP', locale = 'en-GB'): MoneyDisplay {
  const major = minorUnits / 100
  try {
    const standard = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'standard' })
    const compact = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
    return { formatted: standard.format(major), compact: compact.format(major), symbol: standard.formatToParts(0).find(part => part.type === 'currency')?.value ?? currency }
  } catch {
    return formatMoneyDisplay(minorUnits, currency, 'en-GB')
  }
}

/** Add two minor unit values — safe integer arithmetic */
export function addMinorUnits(a: number, b: number): MinorUnits {
  return (a + b) as MinorUnits
}

/** Multiply minor units by a percentage (0–1) */
export function percentOf(minorUnits: number, percent: number): MinorUnits {
  // Use integer math: round(amount * percent_numerator / percent_denominator)
  return Math.round(minorUnits * percent) as MinorUnits
}
