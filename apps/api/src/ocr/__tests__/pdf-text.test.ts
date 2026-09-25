import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractPdfText } from '../extract.js'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('extractPdfText', () => {
  it('reads the text layer of a PDF — PDFs must reach the model as text, not as an image URL', async () => {
    const text = await extractPdfText(readFileSync(path.join(here, 'text-layer.pdf')))
    expect(text).toContain('Policy number TR-123 renews 2026-10-01')
  })

  it('returns an empty string for bytes that are not a readable PDF', async () => {
    expect(await extractPdfText(Buffer.from('not a pdf'))).toBe('')
  })
})
