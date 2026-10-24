/**
 * Allowed upload formats: the single source of truth (CLOUDFLARE_INTEGRATION.md §7.2).
 *
 * Every file must agree three ways: the final extension, the declared MIME
 * type and the detected signature. Only the final extension counts, so
 * `a.pdf.exe` fails on `.exe`. The user's filename is sanitized and kept as
 * metadata only; storage keys are server-generated UUIDs.
 *
 * The Estate Vault keeps its own list (today's types, no DOCX, no WebP
 * conversion): vault files are ciphertext and never go through this pipeline.
 */
import { signatureMatchesMime } from '../extraction/file-signature.js'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const FORMATS = [
  { ext: ['pdf'], mime: ['application/pdf'], kind: 'pdf' },
  { ext: ['docx'], mime: [DOCX_MIME], kind: 'docx' },
  { ext: ['jpg', 'jpeg'], mime: ['image/jpeg'], kind: 'image' },
  { ext: ['png'], mime: ['image/png'], kind: 'image' },
  { ext: ['webp'], mime: ['image/webp'], kind: 'image' },
  { ext: ['gif'], mime: ['image/gif'], kind: 'image' },
  {
    ext: ['heic', 'heif'],
    mime: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    kind: 'image',
  },
] as const

export type FormatKind = (typeof FORMATS)[number]['kind']

export const ALLOWED_UPLOAD_MIME_TYPES: ReadonlySet<string> = new Set(
  FORMATS.flatMap((f) => f.mime as readonly string[]),
)

/** Vault: unchanged from before this pipeline existed (documents.ts's original list). */
export const VAULT_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
])

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

const MAX_FILENAME = 120

/**
 * Display-only filename: no path separators, control or bidi-override
 * characters (a right-to-left override can make `cod.exe` render as
 * `exe.doc`), capped length. Never used to build a key or a path.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = Array.from(base)
    .filter((ch) => {
      const c = ch.codePointAt(0)!
      if (c < 0x20 || c === 0x7f) return false
      if (c >= 0x202a && c <= 0x202e) return false
      if (c >= 0x2066 && c <= 0x2069) return false
      if (c === 0x200e || c === 0x200f || c === 0x061c) return false
      return true
    })
    .join('')
    .trim()
  return (cleaned || 'document').slice(0, MAX_FILENAME)
}

export function finalExtension(filename: string): string {
  const name = sanitizeFilename(filename).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1)
}

export type TypeCheck =
  | { ok: true; kind: FormatKind; mime: string; ext: string }
  | { ok: false; reason: 'unsupported_type' | 'type_mismatch' }

/** Extension and declared MIME must both be allowed and name the same format. */
export function checkDeclaredType(filename: string, mime: string): TypeCheck {
  const ext = finalExtension(filename)
  const m = mime.toLowerCase().trim()
  const byExt = FORMATS.find((f) => (f.ext as readonly string[]).includes(ext))
  const byMime = FORMATS.find((f) => (f.mime as readonly string[]).includes(m))
  if (!byExt || !byMime) return { ok: false, reason: 'unsupported_type' }
  if (byExt !== byMime) return { ok: false, reason: 'type_mismatch' }
  return { ok: true, kind: byExt.kind, mime: m, ext }
}

/** Third leg of the agreement: the bytes' signature. */
export function signatureMatches(bytes: Buffer, mime: string): boolean {
  if (mime === DOCX_MIME) {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    )
  }
  const base = mime.endsWith('-sequence') ? mime.replace('-sequence', '') : mime
  return signatureMatchesMime(bytes, base)
}

// ── PDF structure ──────────────────────────────────────────────────────────

const PDF_ACTIVE: ReadonlyArray<[string, RegExp]> = [
  ['/JavaScript', /\/JavaScript\b/],
  ['/JS', /\/JS\b/],
  ['/Launch', /\/Launch\b/],
  ['/EmbeddedFile', /\/EmbeddedFile\b/],
]
// An inline action dictionary only: `/OpenAction [3 0 R /Fit]` (a page
// destination, as most exporters write) is benign and must not be rejected.
const PDF_OPEN_ACTION =
  /\/OpenAction\s*<<[\s\S]{0,400}?\/S\s*\/(JavaScript|Launch|URI|SubmitForm|ImportData)/
const MB = 1024 * 1024

/**
 * Token scan for active content. Scans the first and last MB (header,
 * trailer and xref live there) plus any object streams' dictionaries in
 * between, which is where these names appear in practice. Names inside
 * compressed object streams are not visible to this check; ClamAV and the
 * forced-download serving cover that residual.
 */
export function pdfActiveContent(bytes: Buffer): string | null {
  const head = bytes.subarray(0, MB).toString('latin1')
  const tail =
    bytes.length > MB ? bytes.subarray(Math.max(MB, bytes.length - MB)).toString('latin1') : ''
  const middle =
    bytes.length > 2 * MB
      ? (bytes
          .subarray(MB, bytes.length - MB)
          .toString('latin1')
          .match(/\d+\s+\d+\s+obj\s*<<[\s\S]{0,2000}?>>/g)
          ?.join('\n') ?? '')
      : ''
  for (const text of [head, middle, tail]) {
    for (const [name, re] of PDF_ACTIVE) if (re.test(text)) return name
    if (PDF_OPEN_ACTION.test(text)) return '/OpenAction'
  }
  return null
}
