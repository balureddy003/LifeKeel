/**
 * Does the yearly premium match twelve monthly ones? Pure: arithmetic on two amounts the household typed.
 *
 * States the gap and points at the policy document. It never says which figure is right, whether to change
 * anything, or names a provider (CLAUDE.md rule 2). A missing figure is never a warning.
 */
export type PremiumCheck =
  | { status: 'not_enough' }
  | { status: 'match' }
  | {
      status: 'mismatch'
      yearlyFromMonthlyMinor: number
      /** Entered yearly amount minus twelve months; negative when the year is lower. */
      differenceMinor: number
      text: string
    }

/** A gap of £1 or less is rounding, not a mismatch. */
export const ROUNDING_TOLERANCE_MINOR = 100

const pounds = (minor: number): string => {
  const abs = Math.abs(minor)
  const whole = abs % 100 === 0
  return `£${(abs / 100).toLocaleString('en-GB', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export function premiumCheck(
  monthlyMinor: number | undefined,
  annualMinor: number | undefined,
): PremiumCheck {
  if (!monthlyMinor || !annualMinor || monthlyMinor <= 0 || annualMinor <= 0)
    return { status: 'not_enough' }
  const yearlyFromMonthlyMinor = monthlyMinor * 12
  const differenceMinor = annualMinor - yearlyFromMonthlyMinor
  if (Math.abs(differenceMinor) <= ROUNDING_TOLERANCE_MINOR) return { status: 'match' }
  return {
    status: 'mismatch',
    yearlyFromMonthlyMinor,
    differenceMinor,
    text:
      `${pounds(monthlyMinor)} a month adds up to ${pounds(yearlyFromMonthlyMinor)} a year. ` +
      `You entered ${pounds(annualMinor)} a year, ${pounds(differenceMinor)} ${differenceMinor < 0 ? 'less' : 'more'}. ` +
      (differenceMinor < 0
        ? 'Some insurers charge less when you pay yearly, so check both figures against your policy document.'
        : 'Check both figures against your policy document.'),
  }
}
