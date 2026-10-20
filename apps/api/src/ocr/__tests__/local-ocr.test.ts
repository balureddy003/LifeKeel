import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DecisionFn } from '@lifekeel/platform'
import { isOcrableImage, LocalOcrError, ocrImageToText } from '../local-ocr.js'
import {
  extractDocumentFieldsLocal,
  LocalExtractionError,
  processDocument,
  screenDocumentForSpecialCategory,
} from '../extract.js'

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
  policy_number: null,
  account_number: null,
  premium: null,
  renewal_date: null,
  maturity_date: null,
  due_date: null,
  coverage_amount: null,
  balance: null,
  interest_rate: null,
  beneficiary: null,
  period: null,
  net_pay: null,
  gross_pay: null,
  claims_phone: null,
  claims_email: null,
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
            summary: 'Life policy',
            provider: ' BrightLife ',
            coverage_amount: '250,000 GBP',
            premium: '   ',
          },
          calls,
        ),
      )
      expect(result).toEqual({
        category: 'insurance',
        fields: { provider: 'BrightLife', coverage_amount: '250,000 GBP', policy_type: 'life' },
        rawText: 'Life policy',
      })
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
        decideWith({ ...allNull, category: 'other', summary: 's' }, calls),
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
      decideWith({ ...allNull, category: 'insurance', policy_type: null, summary: 'pdf' }, calls),
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

describe('special-category document screen (Art. 9 quarantine)', () => {
  function makeDb(updates: Array<Record<string, unknown>>) {
    return {
      collection: () => ({
        updateOne: vi.fn(async (_f: unknown, u: Record<string, unknown>) => {
          updates.push(u)
        }),
      }),
    } as any
  }

  let medBin: string
  let emptyBin: string
  beforeAll(() => {
    // Fake engine printing a clinical discharge letter.
    medBin = path.join(dir, 'med.sh')
    writeFileSync(
      medBin,
      '#!/bin/sh\ncat >/dev/null\nprintf "DISCHARGE SUMMARY\\nPatient: A N Other\\nNHS Number: 943 476 5919\\nWard: Cardiology\\n"\n',
    )
    chmodSync(medBin, 0o755)
    emptyBin = path.join(dir, 'empty-scan.sh')
    writeFileSync(emptyBin, '#!/bin/sh\ncat >/dev/null\n')
    chmodSync(emptyBin, 0o755)
  })

  it('screens extracted text — clinical docs flag, insurance docs clear, unreadable is unscreened', async () => {
    process.env['TESSERACT_BIN'] = medBin
    try {
      const flagged = await screenDocumentForSpecialCategory(png, 'image/png')
      expect(flagged.outcome).toBe('flagged')
      expect(flagged.marker).toMatch(/discharge|patient|nhs/i)
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    process.env['TESSERACT_BIN'] = okBin
    try {
      // "Policy number / Sum assured" must NOT flag — medical vocabulary
      // in insurance product documents is expected and permitted.
      expect((await screenDocumentForSpecialCategory(png, 'image/png')).outcome).toBe('clear')
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    process.env['TESSERACT_BIN'] = emptyBin
    try {
      expect((await screenDocumentForSpecialCategory(png, 'image/png')).outcome).toBe('unscreened')
    } finally {
      delete process.env['TESSERACT_BIN']
    }
  })

  it('holds a flagged document from the hosted vision path — it is never sent', async () => {
    process.env['TESSERACT_BIN'] = medBin
    const updates: Array<Record<string, unknown>> = []
    const vision = vi.fn(async () => '{}')
    try {
      await processDocument(
        makeDb(updates),
        'doc-1',
        'tenant-1',
        png,
        'image/png',
        'letter.png',
        undefined, // no local decide — hosted vision was the only path
        vision as never,
      )
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    expect(vision).not.toHaveBeenCalled()
    const last = updates.at(-1) as { $set: Record<string, unknown> }
    expect(last.$set['status']).toBe('stored')
    expect(last.$set['special_category']).toBe('flagged')
    expect(last.$set['extraction_held_reason']).toBe('special_category')
  })

  it('still reads a flagged document locally — that path never leaves our infra', async () => {
    process.env['TESSERACT_BIN'] = medBin
    const updates: Array<Record<string, unknown>> = []
    const decide = decideWith({
      ...allNull,
      category: 'other',
      policy_type: null,
      summary: 'Letter',
    })
    try {
      await processDocument(
        makeDb(updates),
        'doc-1',
        'tenant-1',
        png,
        'image/png',
        'letter.png',
        decide,
        vi.fn(async () => '{}') as never,
      )
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    const last = updates.at(-1) as { $set: Record<string, unknown> }
    expect(last.$set['status']).toBe('extracted')
    expect(last.$set['special_category']).toBe('flagged')
  })

  it('lets a clear document through hosted vision and records the screen outcome', async () => {
    process.env['TESSERACT_BIN'] = okBin
    const updates: Array<Record<string, unknown>> = []
    const vision = vi.fn(async () => '{"category":"insurance","fields":{},"rawText":"policy"}')
    try {
      await processDocument(
        makeDb(updates),
        'doc-1',
        'tenant-1',
        png,
        'image/png',
        'policy.png',
        undefined,
        vision as never,
      )
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    expect(vision).toHaveBeenCalled()
    const last = updates.at(-1) as { $set: Record<string, unknown> }
    expect(last.$set['status']).toBe('extracted')
    expect(last.$set['special_category']).toBe('clear')
  })

  it('holds a document the client flagged even when the server could not read it', async () => {
    // The device OCR'd pixels this pipeline can't — a client 'flagged'
    // verdict is authoritative even with a server 'unscreened' result.
    process.env['TESSERACT_BIN'] = emptyBin
    const updates: Array<Record<string, unknown>> = []
    const vision = vi.fn(async () => '{}')
    try {
      await processDocument(
        makeDb(updates),
        'doc-1',
        'tenant-1',
        png,
        'image/png',
        'unreadable-scan.png',
        undefined,
        vision as never,
        'flagged',
      )
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    expect(vision).not.toHaveBeenCalled()
    const last = updates.at(-1) as { $set: Record<string, unknown> }
    expect(last.$set['status']).toBe('stored')
    expect(last.$set['special_category']).toBe('flagged')
    expect(last.$set['client_screen']).toBe('flagged')
  })

  it('lets a client-flagged document proceed through the local pipeline', async () => {
    process.env['TESSERACT_BIN'] = emptyBin
    const updates: Array<Record<string, unknown>> = []
    const decide = vi.fn(async () => ({ value: {}, model: 'local', latency_ms: 1 }))
    try {
      await processDocument(
        makeDb(updates),
        'doc-1',
        'tenant-1',
        png,
        'image/png',
        'unreadable-scan.png',
        decide as unknown as DecisionFn,
        undefined,
        'flagged',
      )
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    // Local extraction hit its own "no text" result — but the point is it
    // was never held and never touched a hosted path.
    const last = updates.at(-1) as { $set: Record<string, unknown> }
    expect(last.$set['status']).toBe('extracted')
    expect(last.$set['special_category']).toBe('flagged')
    expect(last.$set['client_screen']).toBe('flagged')
  })

  it('ignores a client clear that contradicts a server flag — flagged wins', async () => {
    process.env['TESSERACT_BIN'] = medBin
    const updates: Array<Record<string, unknown>> = []
    const vision = vi.fn(async () => '{}')
    try {
      await processDocument(
        makeDb(updates),
        'doc-1',
        'tenant-1',
        png,
        'image/png',
        'letter.png',
        undefined,
        vision as never,
        'clear',
      )
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    expect(vision).not.toHaveBeenCalled()
    const last = updates.at(-1) as { $set: Record<string, unknown> }
    expect(last.$set['special_category']).toBe('flagged')
  })

  it('marks unscreened documents that proceed instead of pretending they were checked', async () => {
    process.env['TESSERACT_BIN'] = emptyBin
    const updates: Array<Record<string, unknown>> = []
    const vision = vi.fn(async () => '{"category":"other","fields":{},"rawText":"blank"}')
    try {
      await processDocument(
        makeDb(updates),
        'doc-1',
        'tenant-1',
        png,
        'image/png',
        'blank.png',
        undefined,
        vision as never,
      )
    } finally {
      delete process.env['TESSERACT_BIN']
    }
    const last = updates.at(-1) as { $set: Record<string, unknown> }
    expect(last.$set['special_category']).toBe('unscreened')
  })
})
