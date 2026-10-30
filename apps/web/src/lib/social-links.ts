/**
 * Public profile links for the site footer. Each one comes from a public env
 * var, so a link only renders once the operator has set it; until then the
 * footer keeps its "coming soon" placeholder rather than a dead link.
 */

export type SocialName = 'Instagram' | 'Facebook' | 'LinkedIn' | 'X' | 'WhatsApp'

export interface SocialLink {
  name: SocialName
  href: string
}

const WHATSAPP_GREETING = 'Hi LifeKeel, I have a question.'

/** Only https URLs on the network's own domain are accepted. */
function profileUrl(raw: string | undefined, hosts: string[]): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:') return null
    const host = u.hostname.replace(/^www\./, '')
    return hosts.some((h) => host === h || host.endsWith(`.${h}`)) ? u.toString() : null
  } catch {
    return null
  }
}

/** wa.me wants digits only, country code first, no "+" or spaces. */
export function whatsappLink(raw: string | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(WHATSAPP_GREETING)}`
}

export function socialLinks(env: Record<string, string | undefined>): SocialLink[] {
  const found: Array<[SocialName, string | null]> = [
    ['Instagram', profileUrl(env['NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL'], ['instagram.com'])],
    ['Facebook', profileUrl(env['NEXT_PUBLIC_SOCIAL_FACEBOOK_URL'], ['facebook.com', 'fb.com'])],
    ['LinkedIn', profileUrl(env['NEXT_PUBLIC_SOCIAL_LINKEDIN_URL'], ['linkedin.com'])],
    ['X', profileUrl(env['NEXT_PUBLIC_SOCIAL_X_URL'], ['x.com', 'twitter.com'])],
    ['WhatsApp', whatsappLink(env['NEXT_PUBLIC_WHATSAPP_NUMBER'])],
  ]
  return found.flatMap(([name, href]) => (href ? [{ name, href }] : []))
}
