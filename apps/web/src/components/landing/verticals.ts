/**
 * Two verticals, two doors (owner, 27 Nov 2026): families at family.lifekeel.com and small businesses at
 * business.lifekeel.com. They are separate products with separate stories, never one "team" story.
 *
 * The business door is built but stays hidden until `NEXT_PUBLIC_BUSINESS_DOOR=on`. Turn it on only when
 * both of these are true:
 *   1. business.lifekeel.com is open for sign-ups (the public site shows only what is available today;
 *      NoRoadmap.test.tsx bans "coming soon" and "planned");
 *   2. the business features the door names are `live` rows in claims.ts, with evidence.
 * Until then the home page tells the family story only.
 */
export const BUSINESS_SITE_URL = 'https://business.lifekeel.com'

/** Read at render, so a build (or a test) decides; off unless explicitly switched on. */
export function businessDoorOpen(): boolean {
  // Dot access: Next.js inlines NEXT_PUBLIC_* only when written this way.
  return process.env.NEXT_PUBLIC_BUSINESS_DOOR === 'on'
}

/** Words the family-only page must never carry while the business door is shut. */
export const SHUT_DOOR_WORDS =
  /\b(small business|business owner|team|co-?founder|founder|payroll)\b/i
