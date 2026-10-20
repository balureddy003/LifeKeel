/**
 * One UTM scheme for every link LifeKeel sends out (PRD-210, phase 4).
 *
 *   utm_source    where the link was placed: a network (bluesky, linkedin, ...), "lifecycle" for
 *                 our own emails, "guides" for the site's guide pages
 *   utm_medium    social | email | content
 *   utm_campaign  the pillar (chart, hard_day, ...) or the sequence (lead_nurture, activation, ...)
 *   utm_content   the brief, blog post or email step the link belongs to
 *
 * Signups, leads and funnel rollups are keyed on exactly these four, so a link that strays from
 * the scheme is invisible in the funnel. Build every link through here.
 */
export const UTM_MEDIUMS = ['social', 'email', 'content'] as const
export type UtmMedium = (typeof UTM_MEDIUMS)[number]

export interface Utm {
  source: string
  medium: UtmMedium
  campaign: string
  content?: string
}

const TOKEN = /^[a-z0-9][a-z0-9_.-]{0,63}$/

export function isValidUtm(u: Utm): boolean {
  return (
    TOKEN.test(u.source) &&
    (UTM_MEDIUMS as readonly string[]).includes(u.medium) &&
    TOKEN.test(u.campaign) &&
    (u.content === undefined || TOKEN.test(u.content))
  )
}

/** The query string, without the leading "?". Throws on a value outside the scheme. */
export function utmQuery(u: Utm): string {
  if (!isValidUtm(u)) throw new Error(`utm outside the scheme: ${JSON.stringify(u)}`)
  const p = new URLSearchParams({ utm_source: u.source, utm_medium: u.medium, utm_campaign: u.campaign })
  if (u.content) p.set('utm_content', u.content)
  return p.toString()
}

/** The attribution a visit or signup is counted under; missing values read as direct / none. */
export function attributionKey(a: Record<string, unknown> | null | undefined): { source: string; campaign: string } {
  const s = typeof a?.['utm_source'] === 'string' && a['utm_source'] ? (a['utm_source'] as string) : 'direct'
  const c = typeof a?.['utm_campaign'] === 'string' && a['utm_campaign'] ? (a['utm_campaign'] as string) : 'none'
  return { source: s, campaign: c }
}
