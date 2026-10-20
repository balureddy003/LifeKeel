/** Builds the RFC 9116 security.txt body. Returns null when no contact is configured. */
export function buildSecurityTxt(
  contact,
  now = new Date(),
  canonical = process.env.SECURITY_TXT_CANONICAL,
) {
  const c = (contact ?? '').trim()
  if (!c) return null
  const target = /^(mailto:|https:\/\/)/.test(c) ? c : `mailto:${c}`
  // A year out: a stale file is worse than none, so it expires and the next build refreshes it.
  const expires = new Date(now.getTime() + 365 * 86_400_000).toISOString()
  return [
    `Contact: ${target}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    ...(canonical ? [`Canonical: ${canonical}`] : []),
    '',
  ].join('\n')
}
