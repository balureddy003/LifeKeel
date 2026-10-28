/**
 * Finite map of in-app destinations Keel may point at. Code (never model
 * text) emits a route key; the web client maps it to the same path through
 * its own copy of this table (apps/web/src/lib/keel/routes.ts) and renders
 * nothing for an unknown key. Keep the two tables identical.
 */
export const ROUTE_KEYS = {
  'family-setup': '/family-setup',
  family: '/family',
  'financial-profile.income': '/financial-profile?step=household',
  'financial-profile.protection': '/financial-profile?step=protection',
  'financial-profile.emergency': '/financial-profile?step=emergency',
  'financial-profile.education': '/financial-profile?step=education',
  documents: '/documents',
  upload: '/upload',
  'settings.notifications': '/settings',
  'settings.security': '/settings',
  'settings.automation': '/settings/automation',
  legacy: '/legacy',
  readiness: '/readiness',
  insights: '/insights',
  inbox: '/inbox',
} as const

export type RouteKey = keyof typeof ROUTE_KEYS

export function isRouteKey(value: string): value is RouteKey {
  return Object.prototype.hasOwnProperty.call(ROUTE_KEYS, value)
}
