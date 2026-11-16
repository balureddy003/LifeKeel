/**
 * Fixture sanity for the intent-97 slice-3 statement set: every synthetic
 * PDF in fixtures/docling-statements must yield its six expected banking
 * fields through the CURRENT local text path (unpdf). This pins fixture
 * quality in CI; the Docling-vs-local accuracy eval (>=90% of fixtures
 * reproducing expected fields) runs on demand once the worker exists — see
 * fixtures/docling-statements/README.md.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPdfText } from '../../ocr/extract.js'

const DIR = join(__dirname, '../../../../../fixtures/docling-statements')

interface Expected {
  file: string
  category: string
  layout: string
  expected: Record<string, string>
}

const FIXTURES = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as Expected[]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2367.40' -> '2,367.40' (the format both layouts print). */
const grouped = (decimal: string) => {
  const [whole, frac] = decimal.split('.')
  return `${Number(whole).toLocaleString('en-GB')}.${frac}`
}
/** ISO date -> '01 Jan 2026' (layout A) — layout B prints ISO verbatim. */
const ukDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

describe('docling-statement fixtures (intent 97, slice 3)', () => {
  it('has 10-20 fixtures covering both layouts', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(10)
    expect(FIXTURES.length).toBeLessThanOrEqual(20)
    expect(new Set(FIXTURES.map((f) => f.layout))).toEqual(new Set(['A', 'B']))
  })

  it('every fixture PDF yields text containing its six expected values', async () => {
    for (const fx of FIXTURES) {
      const pdf = readFileSync(join(DIR, fx.file))
      const text = await extractPdfText(pdf)
      expect(text.length, fx.file).toBeGreaterThan(100)
      for (const [key, value] of Object.entries(fx.expected)) {
        if (key.includes('balance') || key.includes('money')) {
          expect(text, `${fx.file} ${key}`).toContain(grouped(value))
        } else {
          // date: ISO (layout B) or '01 Jan 2026' (layout A)
          expect(
            text.includes(value) || text.includes(ukDate(value)),
            `${fx.file} ${key}=${value}`,
          ).toBe(true)
        }
      }
    }
  })

  it('fixture PDFs on disk match expected.json exactly', () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.pdf'))
      .sort()
    expect(onDisk).toEqual(FIXTURES.map((f) => f.file).sort())
  })
})
