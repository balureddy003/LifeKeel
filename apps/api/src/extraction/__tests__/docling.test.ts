import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { doclingParseText } from '../docling.js'
import { extractDocumentFieldsLocal } from '../../ocr/extract.js'

const PDF = readFileSync(join(__dirname, '../../ocr/__tests__/text-layer.pdf'))

const decideStub = async () => ({
  value: { category: 'banking', fields: {} },
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('doclingParseText (intent 97, slice 3 — flag-off worker)', () => {
  it('returns null without DOCLING_SERVICE_URL and never calls fetch', async () => {
    vi.stubEnv('DOCLING_SERVICE_URL', '')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await doclingParseText(PDF, 'application/pdf')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('posts raw bytes with the mime header and returns the text', async () => {
    vi.stubEnv('DOCLING_SERVICE_URL', 'http://docling.internal:8080')
    const spy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: 'parsed text', tables: 2 }), { status: 200 }),
      )
    vi.stubGlobal('fetch', spy)
    const out = await doclingParseText(PDF, 'application/pdf')
    expect(out).toBe('parsed text')
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://docling.internal:8080/v1/parse-document')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-document-mime']).toBe('application/pdf')
    expect(Buffer.from(init.body as Uint8Array)).toEqual(PDF)
  })

  it('returns null on any failure — never throws into the extraction path', async () => {
    vi.stubEnv('DOCLING_SERVICE_URL', 'http://docling.internal:8080')
    for (const bad of [
      vi.fn().mockRejectedValue(new Error('connection refused')),
      vi.fn().mockResolvedValue(new Response('oops', { status: 500 })),
      vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    ]) {
      vi.stubGlobal('fetch', bad)
      expect(await doclingParseText(PDF, 'application/pdf')).toBeNull()
    }
  })
})

describe('extractDocumentFieldsLocal with the Docling path', () => {
  it('uses Docling text when the service is configured', async () => {
    vi.stubEnv('DOCLING_SERVICE_URL', 'http://docling.internal:8080')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ text: 'DOCLING PARSED BANK STATEMENT TEXT' }), {
          status: 200,
        }),
      ),
    )
    const result = await extractDocumentFieldsLocal(
      PDF,
      'application/pdf',
      'stmt.pdf',
      decideStub as never,
    )
    expect(result.text).toBe('DOCLING PARSED BANK STATEMENT TEXT')
  })

  it('falls back to the local text layer when Docling is down', async () => {
    vi.stubEnv('DOCLING_SERVICE_URL', 'http://docling.internal:8080')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const result = await extractDocumentFieldsLocal(
      PDF,
      'application/pdf',
      'stmt.pdf',
      decideStub as never,
    )
    expect(result.text).toBeTruthy()
    expect(result.text).not.toBe('DOCLING PARSED BANK STATEMENT TEXT')
  })

  it('unchanged when the flag is off — local path only', async () => {
    vi.stubEnv('DOCLING_SERVICE_URL', '')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const result = await extractDocumentFieldsLocal(
      PDF,
      'application/pdf',
      'stmt.pdf',
      decideStub as never,
    )
    expect(spy).not.toHaveBeenCalled()
    expect(result.text).toBeTruthy()
  })
})
