/**
 * Upload allow-list, structure checks and image normalization
 * (CLOUDFLARE_INTEGRATION.md §7.2, tests §11.2 "Upload").
 */
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  checkDeclaredType,
  DOCX_MIME,
  pdfActiveContent,
  sanitizeFilename,
  signatureMatches,
  VAULT_ALLOWED_MIME_TYPES,
} from '../formats.js'
import { inspectDocx, normalizeImage } from '../parser-child.js'
import { runParser } from '../parse-sandbox.js'
import { makeDocx, makeZip } from '../../__tests__/helpers/zip.js'

describe('declared type: extension and MIME must agree', () => {
  const accepted: Array<[string, string]> = [
    ['a.pdf', 'application/pdf'],
    ['a.docx', DOCX_MIME],
    ['a.JPG', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
    ['a.gif', 'image/gif'],
    ['a.heic', 'image/heic'],
    ['a.heif', 'image/heif'],
  ]
  it.each(accepted)('accepts %s as %s', (name, mime) => {
    expect(checkDeclaredType(name, mime).ok).toBe(true)
  })

  const refused: Array<[string, string]> = [
    ['a.exe', 'application/octet-stream'],
    ['a.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
    ['a.svg', 'image/svg+xml'],
    ['a.html', 'text/html'],
    ['a.bmp', 'image/bmp'],
    ['a.tiff', 'image/tiff'],
    ['a.pdf.exe', 'application/pdf'],
    ['noext', 'application/pdf'],
  ]
  it.each(refused)('refuses %s (%s)', (name, mime) => {
    expect(checkDeclaredType(name, mime).ok).toBe(false)
  })

  it('refuses an extension and MIME that name different formats', () => {
    expect(checkDeclaredType('a.png', 'application/pdf')).toEqual({ ok: false, reason: 'type_mismatch' })
  })

  it('keeps the vault on its original list (no DOCX)', () => {
    expect(VAULT_ALLOWED_MIME_TYPES.has(DOCX_MIME)).toBe(false)
    expect(VAULT_ALLOWED_MIME_TYPES.has('application/pdf')).toBe(true)
  })
})

describe('filenames', () => {
  it('strips paths, control and bidi-override characters and caps length', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\me\\tax.pdf')).toBe('tax.pdf')
    expect(sanitizeFilename('invoice\u202Efdp.exe')).toBe('invoicefdp.exe')
    expect(sanitizeFilename('a\u0000b.pdf')).toBe('ab.pdf')
    expect(sanitizeFilename('x'.repeat(300)).length).toBe(120)
    expect(sanitizeFilename('')).toBe('document')
  })
})

describe('signatures', () => {
  it('requires the bytes to match the declared type', () => {
    expect(signatureMatches(Buffer.from('%PDF-1.7 rest of file'), 'application/pdf')).toBe(true)
    expect(signatureMatches(Buffer.from('MZ\x90\x00 not a pdf....'), 'application/pdf')).toBe(false)
    expect(signatureMatches(makeDocx('hi'), DOCX_MIME)).toBe(true)
    expect(signatureMatches(Buffer.from('%PDF-1.7 rest of file'), DOCX_MIME)).toBe(false)
  })
})

describe('PDF active content', () => {
  it('rejects JavaScript, Launch, EmbeddedFile and OpenAction actions', () => {
    expect(pdfActiveContent(Buffer.from('%PDF-1.4\n1 0 obj << /JS (app.alert(1)) >>'))).toBe('/JS')
    expect(pdfActiveContent(Buffer.from('%PDF-1.4\n<< /S /Launch /F (cmd.exe) >>'))).toBe('/Launch')
    expect(pdfActiveContent(Buffer.from('%PDF-1.4\n<< /Type /EmbeddedFile >>'))).toBe('/EmbeddedFile')
    expect(
      pdfActiveContent(Buffer.from('%PDF-1.4\n<< /OpenAction << /S /URI /URI (http://x) >> >>')),
    ).toBe('/OpenAction')
  })
  it('accepts an ordinary PDF and a page-destination OpenAction', () => {
    expect(pdfActiveContent(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction [3 0 R /Fit] >>'))).toBeNull()
  })
})

describe('DOCX structure', () => {
  it('accepts a plain document', async () => {
    expect(await inspectDocx(makeDocx('Policy number 123'))).toBeNull()
  })
  it('rejects macros, embedded objects, executables and encryption', async () => {
    expect(await inspectDocx(makeDocx('x', [{ name: 'word/vbaProject.bin', data: 'macro' }]))).toBe('docx_macro')
    expect(await inspectDocx(makeDocx('x', [{ name: 'word/embeddings/oleObject1.bin', data: 'ole' }]))).toBe(
      'docx_embedded_object',
    )
    expect(await inspectDocx(makeDocx('x', [{ name: 'payload.exe', data: 'MZ' }]))).toBe('zip_executable')
    expect(await inspectDocx(makeDocx('x', [{ name: 'word/secret.xml', data: 'x', encrypted: true }]))).toBe(
      'zip_encrypted',
    )
  })
  it('rejects a zip that is not a Word document', async () => {
    expect(await inspectDocx(makeZip([{ name: 'readme.txt', data: 'hello' }]))).toBe('docx_structure')
  })
  it('rejects a zip bomb by compression ratio', async () => {
    const bomb = makeDocx('x', [{ name: 'word/media/big.bin', data: Buffer.alloc(50 * 1024 * 1024) }])
    expect(bomb.length).toBeLessThan(1024 * 1024)
    expect(await inspectDocx(bomb)).toBe('zip_ratio')
  })
})

describe('image normalization (D6)', () => {
  it('re-encodes PNG to lossless WebP at the same dimensions', async () => {
    const png = await sharp({ create: { width: 1234, height: 567, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
    const { header, out } = await normalizeImage(png, 'image/png')
    expect(header.outcome).toBe('ok')
    expect(header.stored).toEqual({ mime: 'image/webp', width: 1234, height: 567 })
    const meta = await sharp(out!).metadata()
    expect(meta.format).toBe('webp')
    expect([meta.width, meta.height]).toEqual([1234, 567])
  })

  it('drops EXIF (including GPS) from JPEG photos', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#a33' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N' } })
      .toBuffer()
    expect((await sharp(jpeg).metadata()).exif).toBeTruthy()
    const { out } = await normalizeImage(jpeg, 'image/jpeg')
    const meta = await sharp(out!).metadata()
    expect(meta.exif).toBeUndefined()
    expect([meta.width, meta.height]).toEqual([300, 200])
  })

  it('keeps only the first frame of an animated GIF', async () => {
    const frame = (c: string) =>
      sharp({ create: { width: 40, height: 30, channels: 4, background: c } }).raw().toBuffer()
    const frames = Buffer.concat([await frame('#f00'), await frame('#0f0'), await frame('#00f')])
    const gif = await sharp(frames, { raw: { width: 40, height: 90, channels: 4, pageHeight: 30 } })
      .gif({ loop: 0 })
      .toBuffer()
    expect((await sharp(gif, { pages: -1 }).metadata()).pages).toBe(3)
    const { header, out } = await normalizeImage(gif, 'image/gif')
    expect(header.stored).toEqual({ mime: 'image/webp', width: 40, height: 30 })
    expect((await sharp(out!).metadata()).pages ?? 1).toBe(1)
  })

  it('rejects an image over the pixel cap without decoding it', async () => {
    const huge = await sharp({ create: { width: 20_001, height: 10, channels: 3, background: '#000' } })
      .png()
      .toBuffer()
    const { header } = await normalizeImage(huge, 'image/png')
    expect(header).toEqual({ outcome: 'rejected', reason: 'image_too_large' })
  })

  it('rejects bytes that do not decode', async () => {
    const { header } = await normalizeImage(Buffer.from('\x89PNG\r\n\x1a\nnot really'), 'image/png')
    expect(header.outcome).toBe('rejected')
  })
})

describe('parser sandbox (child process, empty environment)', () => {
  it('returns the header and normalized bytes over stdout', async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#123' } })
      .png()
      .toBuffer()
    const r = await runParser('image', 'image/png', png)
    expect(r.header.outcome).toBe('ok')
    expect((await sharp(r.out).metadata()).format).toBe('webp')
  }, 30_000)

  it('kills a parser that runs past its deadline', async () => {
    const r = await runParser('image', 'image/png', Buffer.alloc(10), { timeoutMs: 1 })
    expect(r.header).toEqual({ outcome: 'error', reason: 'parser_timeout' })
  })
})
