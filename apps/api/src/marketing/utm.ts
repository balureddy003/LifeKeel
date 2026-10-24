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
  const p = new URLSearchParams({
    utm_source: u.source,
    utm_medium: u.medium,
    utm_campaign: u.campaign,
  })
  if (u.content) p.set('utm_content', u.content)
  return p.toString()
}

/** A value is kept only if it is a plain lowercase token; anything else (free text from the public
 *  events endpoint, a "|", an over-long string) is counted as "other", so rollup keys stay bounded. */
function bucket(v: unknown, empty: string): string {
  if (typeof v !== 'string' || v === '') return empty
  const t = v.trim().toLowerCase()
  return TOKEN.test(t) ? t : 'other'
}

/** The attribution a visit or signup is counted under; missing values read as direct / none. */
export function attributionKey(a: Record<string, unknown> | null | undefined): {
  source: string
  campaign: string
} {
  return {
    source: bucket(a?.['utm_source'], 'direct'),
    campaign: bucket(a?.['utm_campaign'], 'none'),
  }
}

/** The content item (post, brief or email step) a visit or signup came from. */
export function attributionContent(a: Record<string, unknown> | null | undefined): string {
  return bucket(a?.['utm_content'], 'none')
}

const HEX = '0123456789abcdef'

/** Per-post attribution tag (PRD-218): 'p' + 8 lowercase hex chars — always
 *  inside the token rule, and short enough that a stray click reads as a
 *  post, not a slug. Callers store it on the post and must check it against
 *  the collection before use (see uniquePostTag in post-stats.ts). */
export function newPostTag(rand: () => number = Math.random): string {
  let tag = 'p'
  for (let i = 0; i < 8; i++) tag += HEX[Math.floor(rand() * 16) % 16]
  return tag
}
