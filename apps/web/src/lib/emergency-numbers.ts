/**
 * Emergency-services numbers by country, for the "if anyone is in immediate
 * danger" safety notice shown on Emergency Mode and the life-event flows.
 *
 * Found live: every one of these notices hardcoded "call 911" regardless of
 * the signed-in family's actual country — a UK family (or one travelling
 * abroad, the exact real scenario Agent Oak exists for) was being told the
 * wrong number on the one screen where that matters most. This is a small,
 * deliberately non-exhaustive table (a handful of countries this product
 * actually has users in, from the same ISO-3166 alpha-2 codes /auth/me
 * already returns as `country`) rather than a full country database —
 * unknown/unset country falls back to a neutral, still-useful phrasing
 * that doesn't assert a specific wrong number.
 */
export interface EmergencyNumber {
  /** What to actually dial. */
  number: string
  /** Short human label, e.g. "999 in the UK". */
  label: string
}

// Single, unified emergency number per country, covering police/fire/
// ambulance in one call — the common case. A country whose services
// historically used split numbers (e.g. India's separate 100/101/102)
// still gets its modern unified number (112) as the one thing to
// remember under stress.
const EMERGENCY_NUMBERS: Record<string, { number: string; name: string }> = {
  GB: { number: '999', name: 'the UK' },
  IE: { number: '999', name: 'Ireland' },
  US: { number: '911', name: 'the US' },
  CA: { number: '911', name: 'Canada' },
  AU: { number: '000', name: 'Australia' },
  NZ: { number: '111', name: 'New Zealand' },
  IN: { number: '112', name: 'India' }, // unified national number since 2019
  // EU member states standardized on 112.
  FR: { number: '112', name: 'France' },
  DE: { number: '112', name: 'Germany' },
  ES: { number: '112', name: 'Spain' },
  IT: { number: '112', name: 'Italy' },
  NL: { number: '112', name: 'the Netherlands' },
  PT: { number: '112', name: 'Portugal' },
  BE: { number: '112', name: 'Belgium' },
  SE: { number: '112', name: 'Sweden' },
  FI: { number: '112', name: 'Finland' },
  DK: { number: '112', name: 'Denmark' },
  PL: { number: '112', name: 'Poland' },
  AT: { number: '112', name: 'Austria' },
}

export function emergencyNumberFor(countryCode?: string): EmergencyNumber {
  const entry = countryCode ? EMERGENCY_NUMBERS[countryCode.toUpperCase()] : undefined
  if (entry) return { number: entry.number, label: `${entry.number} in ${entry.name}` }
  // No known country on file — 112 works from most mobile phones worldwide
  // (including a UK/US phone roaming abroad), with 911 named too since
  // it's the number people are likeliest to already know by heart.
  return { number: '112', label: '112 (or 911, or your local emergency number)' }
}
