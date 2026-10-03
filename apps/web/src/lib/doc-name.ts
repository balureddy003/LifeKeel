// Degenerate filenames — camera captures and mail scanners occasionally
// store a file whose name is just an extension or punctuation ("-JPEG",
// ".png", "-.HEIC"). Rendering those verbatim in lists and AI Memory cards
// reads as a bug and lowers trust in the review prompt around them
// ("I read "-JPEG" from your uploads" — what did you read?). When the name
// carries no information, substitute a descriptive one.

const EXTENSION_ONLY = /^[\s\-_.]*(jpe?g|png|heic|heif|webp|gif|bmp|pdf|docx?|xlsx?|csv)$/i
// Dot is optional — a degenerate name is often just the extension token
// itself ("-JPEG"), and real names keep theirs ("scan.jpg").
const IMAGE_TOKEN = /(?:^|[\s\-_.])(jpe?g|png|heic|heif|webp|gif|bmp)$/i
const DOC_TOKEN = /(?:^|[\s\-_.])(pdf|docx?|xlsx?|csv)$/i

function isDegenerateFilename(filename: string): boolean {
  const trimmed = filename.trim()
  if (EXTENSION_ONLY.test(trimmed)) return true
  // A stem with no letters or digits at all ("- . jpeg", "—") is noise.
  const stem = trimmed.replace(/\.[^.]+$/, '')
  return !/[\p{L}\p{N}]/u.test(stem)
}

function shortDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return ` · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

/**
 * The name to show a user for a stored document. Real filenames pass
 * through untouched; content-free ones become "Scanned image · 2 Oct" /
 * "Document · 2 Oct" so the user can still tell which upload it was.
 */
export function displayDocName(doc: { filename: string; uploadedAt?: string }): string {
  if (!isDegenerateFilename(doc.filename)) return doc.filename
  const kind = IMAGE_TOKEN.test(doc.filename)
    ? 'Scanned image'
    : DOC_TOKEN.test(doc.filename) ? 'Scanned document' : 'Document'
  return `${kind}${shortDate(doc.uploadedAt)}`
}
