/**
 * Derives age and years-until-a-target-age from a date of birth, so forms
 * can stop asking for raw age/years-remaining numbers that drift stale the
 * moment a birthday passes — see the family roster's optional
 * `dateOfBirth` (auth-types.ts) and its use in the Financial Profile
 * wizard's Retirement and Education Funds steps.
 *
 * Plain Date arithmetic — no date library exists in this repo and none is
 * needed for whole-year age math.
 */

/** Whole years elapsed since `dob` ('YYYY-MM-DD'), as of today. */
export function calculateAge(dob: string): number {
  const birth = new Date(`${dob}T00:00:00Z`)
  const now = new Date()
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return Math.max(0, age)
}

/** Whole years from today until `dob`'s owner turns `targetAge`. Never negative — a milestone already passed reads as 0, not a past-due number. */
export function yearsUntil(dob: string, targetAge: number): number {
  return Math.max(0, targetAge - calculateAge(dob))
}
