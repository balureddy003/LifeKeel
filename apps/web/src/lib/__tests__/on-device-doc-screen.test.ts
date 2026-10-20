import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screenDocumentBeforeUpload } from '../on-device-doc-screen'

let ocrText = ''
const recognize = vi.fn(async () => ({ data: { text: ocrText } }))
const terminate = vi.fn(async () => undefined)

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({ recognize, terminate })),
}))

let pdfText = ''
vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: pdfText })),
}))

// jsdom's File lacks Blob.arrayBuffer — polyfill it; the bytes are never
// read because unpdf is mocked.
if (!File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = async function (this: File) {
    return new Uint8Array(64).buffer
  }
}

function fileOf(type: string, size = 1024): File {
  const f = new File([new Uint8Array(64)], 'doc', { type })
  // File.size is derived from content in jsdom — stub it for the cap tests.
  Object.defineProperty(f, 'size', { value: size })
  return f
}

beforeEach(() => {
  ocrText = ''
  pdfText = ''
  vi.clearAllMocks()
})

describe('screenDocumentBeforeUpload', () => {
  it('flags a clinical image document', async () => {
    ocrText = 'DISCHARGE SUMMARY — Patient: A N Other. NHS Number: 943 476 5919. Ward: Cardiology.'
    expect(await screenDocumentBeforeUpload(fileOf('image/png'))).toEqual({ outcome: 'flagged' })
    expect(terminate).toHaveBeenCalled()
  })

  it('clears an insurance document — medical product vocabulary does not flag', async () => {
    ocrText =
      'BRIGHTLIFE CRITICAL ILLNESS COVER. Policy number BL-1. ' +
      'This plan pays out on diagnosis of a covered condition including cancer. Sum assured: 250,000 GBP.'
    expect(await screenDocumentBeforeUpload(fileOf('image/jpeg'))).toEqual({ outcome: 'clear' })
  })

  it('returns unscreened when OCR finds no usable text', async () => {
    ocrText = '   '
    expect(await screenDocumentBeforeUpload(fileOf('image/png'))).toEqual({ outcome: 'unscreened' })
  })

  it('returns unscreened when the engine throws — never blocks the upload', async () => {
    recognize.mockRejectedValueOnce(new Error('engine blew up'))
    expect(await screenDocumentBeforeUpload(fileOf('image/png'))).toEqual({ outcome: 'unscreened' })
  })

  it('screens a PDF text layer without OCR', async () => {
    pdfText = 'GP SURGERY — repeat prescription enclosed for patient review. ' + 'x'.repeat(20)
    expect(await screenDocumentBeforeUpload(fileOf('application/pdf'))).toEqual({
      outcome: 'flagged',
    })
    expect(recognize).not.toHaveBeenCalled()
  })

  it('marks a scanned PDF (empty text layer) unscreened', async () => {
    pdfText = ''
    expect(await screenDocumentBeforeUpload(fileOf('application/pdf'))).toEqual({
      outcome: 'unscreened',
    })
  })

  it('skips oversized files without touching the OCR engine', async () => {
    expect(await screenDocumentBeforeUpload(fileOf('image/png', 16 * 1024 * 1024))).toEqual({
      outcome: 'unscreened',
    })
    expect(recognize).not.toHaveBeenCalled()
  })

  it('returns unscreened for unsupported types', async () => {
    expect(await screenDocumentBeforeUpload(fileOf('application/zip'))).toEqual({
      outcome: 'unscreened',
    })
  })
})
