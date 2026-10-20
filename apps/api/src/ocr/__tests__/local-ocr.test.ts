import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DecisionFn } from '@lifekeel/platform'
import { isOcrableImage, LocalOcrError, ocrImageToText } from '../local-ocr.js'
import { extractDocumentFieldsLocal, LocalExtractionError, processDocument } from '../extract.js'

let dir: string
let okBin: string
let failBin: string
const png = Buffer.from('not-a-real-png')

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fake-tesseract-'))
  okBin = path.join(dir, 'ok.sh')
  failBin = path.join(dir, 'fail.sh')
  // Fake engine: consumes stdin, prints a policy document.
  writeFileSync(
    okBin,
    '#!/bin/sh\ncat >/dev/null\nprintf "BRIGHTLIFE\\n\\n\\nPolicy number: BL-1\\nSum assured: 250,000 GBP  \\n"\n',
  )
  writeFileSync(failBin, '#!/bin/sh\ncat >/dev/null\necho boom >&2\nexit 3\n')
  chmodSync(okBin, 0o755)
  chmodSync(failBin, 0o755)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('ocrImageToText', () => {
  it('returns the engine text with whitespace tidied', async () => {
    expect(await ocrImageToText(png, 'image/png', okBin)).toBe(
      'BRIGHTLIFE\n\nPolicy number: BL-1\nSum assured: 250,000 GBP',
    )
  })

  it('rejects unsupported types and oversized images before spawning anything', async () => {
    await expect(ocrImageToText(png, 'application/zip', okBin)).rejects.toBeInstanceOf(
      LocalOcrError,
    )
    await expect(
      ocrImageToText(Buffer.alloc(16 * 1024 * 1024), 'image/png', okBin),
    ).rejects.toThrow(/too large/)
  })

  it('surfaces a non-zero exit as a LocalOcrError', async () => {
    await expect(ocrImageToText(png, 'image/png', failBin)).rejects.toThrow(/exit 3\): boom/)
  })

  it('reports a missing engine clearly instead of hanging', async () => {
    await expect(
      ocrImageToText(png, 'image/png', path.join(dir, 'does-not-exist')),
    ).rejects.toThrow(/unavailable/)
  })

  it('knows which mime types are images', () => {
    expect(isOcrableImage('image/PNG')).toBe(true)
    expect(isOcrableImage('application/pdf')).toBe(false)
  })
})

const allNull = {
  provider: null,
  policy_type: null,
  policy_number: null,
  coverage_amount: null,
  premium: null,
  renewal_date: null,
  has_beneficiary: null,
  claims_phone: null,
  claims_email: null,
  balance: null,
  net_pay: null,
  gross_pay: null,
  document_date: null,
}
const decideWith = (
  value: unknown,
  calls: Array<{ system: string; prompt: string; jsonSchema: Record<string, unknown> }> = [],
) =>
  (async (req: { system: string; prompt: string; jsonSchema: Record<string, unknown> }) => {
    calls.push(req)
    return { value, model: 'local', latency_ms: 1 }
  }) as unknown as DecisionFn

describe('extractDocumentFieldsLocal', () => {
  it('reads an image through local OCR then the local model, keeping only stated fields', async () => {
    process.env['TESSERACT_BIN'] = okBin
    try {
      const calls: Array<{ system: string; prompt: string; jsonSchema: Record<string, unknown> }> =
        []
      const result = await extractDocumentFieldsLocal(
        png,
        'image/png',
        'policy.png',
        decideWith(
          {
            ...allNull,
            category: 'insurance',
            policy_type: 'life',
            provider: ' BrightLife ',
            coverage_amount: '250,000 GBP',
            premium: '   ',
          },
          calls,
        ),
      )
      expect(result).toMatchObject({
        category: 'insurance',
        fields: { provider: 'BrightLife', coverage_amount: '250,000 GBP', policy_type: 'life' },
        // No free-text summary is kept (PRD-143): it could carry health or third-party details.
        rawText: '',
        extractor: { kind: 'local' },
      })
      expect(result.text).toContain('Policy number: BL-1')
      // OCR text reached the model inside the untrusted-data wrapper.
      expect(calls[0]!.prompt).toContain('<document_text>')
      expect(calls[0]!.prompt).toContain('Policy number: BL-1')
      expect(calls[0]!.system.toLowerCase()).toContain('untrusted')
    } finally {
      delete process.env['TESSERACT_BIN']
    }
  })

  it('requires every key in the decoding schema so small models do not skip fields', async () => {
    process.env['TESSERACT_BIN'] = okBin
    try {
      const calls: Array<{ system: string; prompt: string; jsonSchema: Record<string, unknown> }> =
        []
      await extractDocumentFieldsLocal(
        png,
        'image/png',
        'a.png',
        decideWith({ ...allNull, category: 'other' }, calls),
      )
      const schema = calls[0]!.jsonSchema as {
        properties: Record<string, unknown>
        required: string[]
      }
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
    } finally {
      delete process.env['TESSERACT_BIN']
    }
  })

  it('never calls the model when OCR finds no text', async () => {
    const empty = path.join(dir, 'empty.sh')
    writeFileSync(empty, '#!/bin/sh\ncat >/dev/null\n')
    chmodSync(empty, 0o755)
    process.env['TESSERACT_BIN'] = empty
    try {
      const decide = vi.fn()
      const result = await extractDocumentFieldsLocal(
        png,
        'image/png',
        'blank.png',
        decide as unknown as DecisionFn,
      )
      expect(result.category).toBe('other')
      expect(decide).not.toHaveBeenCalled()
    } finally {
      delete process.env['TESSERACT_BIN']
    }
  })

  it('reads a PDF from its text layer without OCR', async () => {
    const pdf = readFileSync(path.join(__dirname, 'text-layer.pdf'))
    const calls: Array<{ system: string; prompt: string; jsonSchema: Record<string, unknown> }> = []
    const result = await extractDocumentFieldsLocal(
      pdf,
      'application/pdf',
      'doc.pdf',
      decideWith({ ...allNull, category: 'insurance', policy_type: null }, calls),
    )
    expect(result.category).toBe('insurance')
    expect(calls).toHaveLength(1)
  })

  it('throws LocalExtractionError, not a fake empty result, when the model fails, so the failure can be retried', async () => {
    const down = (async () => {
      throw new Error('refused')
    }) as unknown as DecisionFn
    process.env['TESSERACT_BIN'] = okBin
    try {
      await expect(extractDocumentFieldsLocal(png, 'image/png', 'a.png', down)).rejects.toThrow(
        /Local model failed: refused/,
      )
      await expect(
        extractDocumentFieldsLocal(png, 'image/png', 'a.png', down),
      ).rejects.toBeInstanceOf(LocalExtractionError)
    } finally {
      delete process.env['TESSERACT_BIN']
    }
  })

  it('throws when the OCR engine itself is missing or fails', async () => {
    process.env['TESSERACT_BIN'] = path.join(dir, 'does-not-exist')
    try {
      await expect(
        extractDocumentFieldsLocal(png, 'image/png', 'a.png', vi.fn() as unknown as DecisionFn),
      ).rejects.toThrow(/OCR engine failed/)
    } finally {
      delete process.env['TESSERACT_BIN']
    }
  })

  it('still returns a plain empty result for unsupported types (nothing to retry)', async () => {
    const unsupported = await extractDocumentFieldsLocal(
      png,
      'application/zip',
      'a.zip',
      vi.fn() as unknown as DecisionFn,
    )
    expect(unsupported.rawText).toContain('Unsupported')
  })
})

describe('processDocument with a failing local model', () => {
  it('records a retryable error with a retry count instead of an "extracted" status', async () => {
    process.env['TESSERACT_BIN'] = okBin
    const updates: Array<Record<string, unknown>> = []
    const db = {
      collection: () => ({
        updateOne: vi.fn(async (_f: unknown, u: Record<string, unknown>) => {
          updates.push(u)
        }),
      }),
    } as any
    const down = (async () => {
      throw new Error('refused')
    }) as unknown as DecisionFn
    try {
      await processDocument(db, 'doc-1', 'tenant-1', png, 'image/png', 'a.png', down)
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    const last = updates.at(-1) as { $set: Record<string, unknown>; $inc: Record<string, number> }
    expect(last.$set['status']).toBe('error')
    expect(String(last.$set['error_message'])).toContain('Local model failed')
    expect(last.$inc['retry_count']).toBe(1)
    expect(updates.some((u) => (u as any).$set?.status === 'extracted')).toBe(false)
  })
})
