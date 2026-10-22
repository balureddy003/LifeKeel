/**
 * Names people choose (their own, their family's, a roster member's) are
 * sent verbatim in invitation and continuity emails from LifeKeel's domain
 * to addresses the organizer enters. HTML is escaped at render time; this
 * stops the other abuse, a "name" that is really a phishing message (R43).
 */

const MAX_NAME_LENGTH = 80
const LINK_RE = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|co|uk|io|app|info|biz|xyz|ru|me|ly|link|online|site)\b)/i
const PHONE_RE = /(\+?\d[\s().-]?){7,}/
// Control characters and bidi overrides, built from code points so the
// source holds no invisible characters.
const CONTROL_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}\u202a-\u202e\u2066-\u2069]`,
)

/** Returns an error message, or null when `value` is acceptable as a display name. */
export function displayNameError(value: unknown, label = 'Name'): string | null {
  if (typeof value !== 'string' || !value.trim()) return `${label} required`
  const name = value.trim()
  if (name.length > MAX_NAME_LENGTH) return `${label} must be ${MAX_NAME_LENGTH} characters or fewer`
  if (CONTROL_RE.test(name)) return `${label} contains characters that aren't allowed`
  if (name.includes('@') || LINK_RE.test(name) || PHONE_RE.test(name)) {
    return `${label} can't contain links, email addresses or phone numbers`
  }
  return null
}
