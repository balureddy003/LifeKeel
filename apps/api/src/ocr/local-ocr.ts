import { spawn } from 'node:child_process'

/**
 * Local image OCR using the Tesseract binary (apk add tesseract-ocr tesseract-ocr-data-eng
 * in the API image). Runs entirely inside our infrastructure: the document image
 * never leaves the process, unlike the cloud vision path.
 *
 * The binary is invoked with an argument array (no shell) and the image on stdin.
 */

const OCR_TIMEOUT_MS = 60_000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_TEXT_CHARS = 12_000
const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/bmp', 'image/gif', 'image/webp'])

export class LocalOcrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalOcrError'
  }
}

export function isOcrableImage(mimeType: string): boolean {
  return SUPPORTED.has(mimeType.toLowerCase())
}

/** Returns the recognised text (possibly empty). Throws LocalOcrError if the engine is missing or fails. */
export function ocrImageToText(image: Buffer, mimeType: string, bin = process.env['TESSERACT_BIN'] ?? 'tesseract'): Promise<string> {
  if (!isOcrableImage(mimeType)) return Promise.reject(new LocalOcrError(`Unsupported image type: ${mimeType}`))
  if (image.length > MAX_IMAGE_BYTES) return Promise.reject(new LocalOcrError('Image too large for local OCR'))

  return new Promise((resolve, reject) => {
    // --psm 3: fully automatic page segmentation, the safest default for scanned letters.
    const child = spawn(bin, ['stdin', 'stdout', '-l', 'eng', '--psm', '3'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    let settled = false
    const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn() } }
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(() => reject(new LocalOcrError('Local OCR timed out'))) }, OCR_TIMEOUT_MS)

    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => { err += d.toString().slice(0, 500) })
    child.on('error', (e) => done(() => reject(new LocalOcrError(`Local OCR engine unavailable: ${e.message}`))))
    child.on('close', (code) => done(() => {
      if (code !== 0) return reject(new LocalOcrError(`Local OCR failed (exit ${code}): ${err.trim()}`))
      resolve(Buffer.concat(out).toString('utf8').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT_CHARS))
    }))
    child.stdin.on('error', () => { /* surfaced via close/error */ })
    child.stdin.end(image)
  })
}
