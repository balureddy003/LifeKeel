/**
 * On-device document pre-screen (device-first blueprint §4).
 *
 * Runs BEFORE `/documents/upload` so the device can check a document for
 * likely clinical-record content using text it can read locally —
 * Tesseract OCR for images, the PDF text layer for PDFs — and pass the
 * outcome to the server with the upload. The server still runs its own
 * screen in `processDocument`; a client `flagged` verdict is treated as
 * authoritative (the client may have OCR'd pixels the server cannot —
 * e.g. an image its Tesseract build can't read), while `clear` can only
 * inform, never downgrade, the server result.
 *
 * Everything here is best-effort: any failure returns 'unscreened' and
 * the upload proceeds — the residual risk stays visible in
 * `special_category` on the document record instead of being pretended
 * away.
 *
 * Dependencies are dynamically imported so the upload path pays nothing
 * unless this screen actually runs. tesseract.js loads its worker/wasm/
 * language assets from its bundled CDN endpoints — document bytes are
 * never transmitted (inference is fully local), but the runtime itself
 * requires network access on first use.
 */

// Deliberate twin of DOCUMENT_SPECIAL_CATEGORY_RE in
// apps/api/src/ocr/extract.ts — keep the two in sync. This is the narrow
// *clinical-document letterhead* vocabulary (discharge summary, NHS
// number, prescription, "diagnosed with"), NOT the broad user-disclosure
// screen: insurance product documents legitimately print "cancer",
// "critical illness" and "diagnosis of a covered condition", and
// flagging those would hold the documents the feature exists to read.
const DOCUMENT_SPECIAL_CATEGORY_RE =
  /\b(nhs\s?(number|no|trust)|\bpatients?\b|discharge\s+(summary|letter|notes)|outpatient|inpatient|gp\s+(surgery|practice)|general practitioner|prescription|repeat\s+prescription|consultant\b|clinic\b|clinical\b|medical\s+(record|history|certificate|report|centre|notes)|sick\s+note|fit\s+note|referral\s+letter|diagnosed\s+with|a&e\b|accident\s+and\s+emergency|antenatal|chemotherapy|radiotherapy|dialysis|biopsy|mental\s+health\s+act|sectioned)\b/i

export type ClientDocScreenOutcome = 'clear' | 'flagged' | 'unscreened'

export interface ClientDocScreen {
  outcome: ClientDocScreenOutcome
}

const OCR_TIMEOUT_MS = 45_000
// Mirrors the server's OCR size cap — a file too big for the device to
// OCR quickly proceeds to upload unscreened rather than blocking.
const MAX_SCREEN_BYTES = 15 * 1024 * 1024
const MIN_SCREEN_CHARS = 40

const UNSCREENED: ClientDocScreen = { outcome: 'unscreened' }

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

async function ocrImageText(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  try {
    const result = await withTimeout(worker.recognize(file), OCR_TIMEOUT_MS)
    return result?.data?.text ?? ''
  } finally {
    await worker.terminate().catch(() => undefined)
  }
}

async function pdfTextLayer(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
  const { text } = await extractText(doc, { mergePages: true })
  return typeof text === 'string' ? text : ''
}

/**
 * Reads whatever text the device can cheaply reach and screens it for
 * clinical-document markers. Never throws — returns 'unscreened' on any
 * failure, unsupported type, oversized file, or near-empty result.
 *
 * Scanned PDFs (no text layer) currently return 'unscreened': rasterising
 * pages client-side for OCR is a heavier lift tracked in ARCHITECTURE.md.
 */
export async function screenDocumentBeforeUpload(file: File): Promise<ClientDocScreen> {
  try {
    if (file.size > MAX_SCREEN_BYTES) return UNSCREENED

    let text = ''
    if (file.type === 'application/pdf') {
      text = (await withTimeout(pdfTextLayer(file), OCR_TIMEOUT_MS)) ?? ''
    } else if (file.type.startsWith('image/')) {
      text = await ocrImageText(file)
    } else {
      return UNSCREENED
    }

    if (text.trim().length < MIN_SCREEN_CHARS) return UNSCREENED
    return DOCUMENT_SPECIAL_CATEGORY_RE.test(text) ? { outcome: 'flagged' } : { outcome: 'clear' }
  } catch {
    return UNSCREENED
  }
}
