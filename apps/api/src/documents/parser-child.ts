/**
 * Untrusted-format parser, run as a separate child process
 * (CLOUDFLARE_INTEGRATION.md §7.11 "Parser isolation").
 *
 * Spawned by parse-sandbox.ts with an EMPTY environment (no R2, Mongo, Redis
 * or ClamAV credentials), a hard timeout and a V8 heap cap, under Node's
 * permission model where available (no fs writes, no child processes). It
 * opens no sockets by design. Bytes arrive on stdin; the result goes to
 * stdout as `<u32 header length><JSON header><output bytes>`.
 *
 * Usage: node parser-child.js <kind> <mime>
 */
import sharp, { type Metadata } from 'sharp'
import yauzl from 'yauzl'
import { pdfActiveContent } from './formats.js'

export interface ParseHeader {
  outcome: 'ok' | 'rejected' | 'error'
  reason?: string
  /** For images: the stored representation. */
  stored?: { mime: string; width: number; height: number }
}

export const MAX_PIXELS = 100_000_000
export const MAX_SIDE = 20_000
const DOCX_MAX_ENTRIES = 1000
const DOCX_MAX_UNCOMPRESSED = 100 * 1024 * 1024
const DOCX_MAX_RATIO = 100

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

function emit(header: ParseHeader, out: Buffer = Buffer.alloc(0)): void {
  const json = Buffer.from(JSON.stringify(header))
  const len = Buffer.alloc(4)
  len.writeUInt32BE(json.length)
  process.stdout.write(Buffer.concat([len, json, out]))
}

export async function inspectDocx(bytes: Buffer): Promise<string | null> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, z) => (err || !z ? reject(err ?? new Error('zip')) : resolve(z)),
    ),
  )
  return new Promise<string | null>((resolve) => {
    let entries = 0
    let total = 0
    let hasTypes = false
    let hasDocument = false
    let settled = false
    const finish = (reason: string | null) => {
      if (settled) return
      settled = true
      try {
        zip.close()
      } catch {
        /* already closed */
      }
      resolve(reason)
    }
    zip.on('error', () => finish('zip_invalid'))
    zip.on('end', () => {
      if (!hasTypes || !hasDocument) return finish('docx_structure')
      finish(null)
    })
    zip.on('entry', (entry: yauzl.Entry) => {
      entries++
      const name = entry.fileName
      const lower = name.toLowerCase()
      if (entries > DOCX_MAX_ENTRIES) return finish('zip_too_many_entries')
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) return finish('zip_encrypted')
      if (lower.endsWith('vbaproject.bin')) return finish('docx_macro')
      if (lower.startsWith('word/embeddings/')) return finish('docx_embedded_object')
      if (/\.(exe|dll|com|scr|bat|cmd|ps1|js|vbs|msi)$/.test(lower)) return finish('zip_executable')
      if (name === '[Content_Types].xml') hasTypes = true
      if (name === 'word/document.xml') hasDocument = true
      const declared = entry.uncompressedSize
      if (declared / Math.max(entry.compressedSize, 1) > DOCX_MAX_RATIO) return finish('zip_ratio')
      if (name.endsWith('/')) return zip.readEntry()
      // Decompress for real and count: header sizes can lie, and yauzl's
      // validateEntrySizes fails the stream if they do.
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return finish('zip_invalid')
        stream.on('data', (c: Buffer) => {
          total += c.length
          if (total > DOCX_MAX_UNCOMPRESSED) {
            stream.destroy()
            finish('zip_too_large')
          }
        })
        stream.on('error', () => finish('zip_invalid'))
        stream.on('end', () => !settled && zip.readEntry())
      })
    })
    zip.readEntry()
  })
}

/**
 * Re-encode to WebP at the original pixel dimensions (D6): upright via EXIF
 * orientation, all metadata (GPS included) dropped, first frame only.
 * Lossless for PNG/GIF (flat colour and text: keeps OCR intact); lossy q90
 * for photos, falling back to lossless if lossy came out larger.
 */
export async function normalizeImage(
  bytes: Buffer,
  mime: string,
): Promise<{ header: ParseHeader; out?: Buffer }> {
  sharp.cache(false)
  sharp.concurrency(1)
  let meta: Metadata
  try {
    meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS, pages: 1 }).metadata()
  } catch (err) {
    const msg = String((err as Error).message ?? err)
    if (/heif|hevc|heic/i.test(msg) && /heic|heif/.test(mime))
      return { header: { outcome: 'error', reason: 'heic_decoder_unavailable' } }
    if (/pixel limit/i.test(msg))
      return { header: { outcome: 'rejected', reason: 'image_too_large' } }
    return { header: { outcome: 'rejected', reason: 'image_undecodable' } }
  }
  const w = meta.width ?? 0
  const h = meta.pageHeight ?? meta.height ?? 0
  if (!w || !h) return { header: { outcome: 'rejected', reason: 'image_undecodable' } }
  if (w * h > MAX_PIXELS || w > MAX_SIDE || h > MAX_SIDE)
    return { header: { outcome: 'rejected', reason: 'image_too_large' } }

  const base = () =>
    sharp(bytes, { limitInputPixels: MAX_PIXELS, pages: 1, failOn: 'error' }).rotate()
  const lossless = mime === 'image/png' || mime === 'image/gif'
  try {
    let out = lossless
      ? await base().webp({ lossless: true, effort: 4 }).toBuffer()
      : await base().webp({ quality: 90, smartSubsample: true, effort: 4 }).toBuffer()
    if (!lossless && out.length > bytes.length) {
      const alt = await base().webp({ lossless: true, effort: 4 }).toBuffer()
      if (alt.length < out.length) out = alt
    }
    const outMeta = await sharp(out).metadata()
    return {
      header: {
        outcome: 'ok',
        stored: { mime: 'image/webp', width: outMeta.width ?? 0, height: outMeta.height ?? 0 },
      },
      out,
    }
  } catch (err) {
    const msg = String((err as Error).message ?? err)
    if (/heif|hevc|heic/i.test(msg) && /heic|heif/.test(mime))
      return { header: { outcome: 'error', reason: 'heic_decoder_unavailable' } }
    return { header: { outcome: 'rejected', reason: 'image_undecodable' } }
  }
}

async function main(): Promise<void> {
  const [kind, mime = ''] = process.argv.slice(2)
  const bytes = await readStdin()
  if (kind === 'pdf') {
    const active = pdfActiveContent(bytes)
    return active
      ? emit({ outcome: 'rejected', reason: `pdf_active:${active}` })
      : emit({ outcome: 'ok' })
  }
  if (kind === 'docx') {
    try {
      const reason = await inspectDocx(bytes)
      return reason ? emit({ outcome: 'rejected', reason }) : emit({ outcome: 'ok' })
    } catch {
      return emit({ outcome: 'rejected', reason: 'zip_invalid' })
    }
  }
  if (kind === 'image') {
    const { header, out } = await normalizeImage(bytes, mime)
    return emit(header, out)
  }
  emit({ outcome: 'rejected', reason: 'unknown_kind' })
}

// Only run when executed as the child, not when imported by tests.
if (process.argv[1] && /parser-child\.(js|ts)$/.test(process.argv[1])) {
  main().catch((err) => {
    emit({ outcome: 'error', reason: String((err as Error).message ?? err).slice(0, 80) })
  })
}
