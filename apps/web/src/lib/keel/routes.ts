/**
 * Route keys Keel may point at. Must stay identical to the API table
 * (apps/api/src/keel-agent/route-keys.ts); a test compares them. The model
 * never produces a path: the server sends a key, and an unknown key
 * resolves to null, so nothing renders and nothing navigates.
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

export function resolveRouteKey(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(ROUTE_KEYS, key) ? ROUTE_KEYS[key as RouteKey] : null
}
