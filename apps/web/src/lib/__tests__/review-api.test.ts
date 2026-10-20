/** PRD-143 web helpers: the right requests, and the server's reason surfaced as plain words. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmDocumentType, reviewDocumentFields } from '../api'

const mockFetch = (status: number, body: unknown) => {
  const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

describe('confirmDocumentType', () => {
  it('posts the chosen type and reports success', async () => {
    const fn = mockFetch(200, { id: 'd1', category: 'pension', confirmed: true })
    expect(await confirmDocumentType('d1', 'pension')).toEqual({ ok: true })
    const [url, init] = fn.mock.calls[0]!
    expect(String(url)).toMatch(/\/documents\/d1\/confirm-type$/)
    expect(JSON.parse(init.body)).toEqual({ category: 'pension' })
  })

  it('returns the server’s reason, or a network message', async () => {
    mockFetch(400, { error: 'Choose one of the document types' })
    expect(await confirmDocumentType('d1', 'x')).toEqual({
      ok: false,
      error: 'Choose one of the document types',
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await confirmDocumentType('d1', 'pension')).toEqual({
      ok: false,
      error: 'Network error — please try again',
    })
  })
})

describe('reviewDocumentFields', () => {
  it('sends the decisions and returns the updated candidates', async () => {
    const fn = mockFetch(200, { candidates: [{ key: 'premium', status: 'confirmed' }] })
    const r = await reviewDocumentFields('d1', [{ key: 'premium', action: 'confirm' }])
    expect(r).toEqual({ ok: true, candidates: [{ key: 'premium', status: 'confirmed' }] })
    expect(JSON.parse(fn.mock.calls[0]![1].body)).toEqual({
      decisions: [{ key: 'premium', action: 'confirm' }],
    })
  })

  it('turns an invalid value into a plain sentence and passes other reasons through', async () => {
    mockFetch(400, {
      error: 'Invalid review',
      problems: [{ key: 'premium', reason: 'invalid_value' }],
    })
    expect(
      await reviewDocumentFields('d1', [{ key: 'premium', action: 'edit', value: 'x' }]),
    ).toEqual({
      ok: false,
      error: 'That value does not look right for this field.',
    })
    mockFetch(409, { error: 'Nothing has been extracted from this document yet' })
    expect(await reviewDocumentFields('d1', [{ key: 'premium', action: 'confirm' }])).toEqual({
      ok: false,
      error: 'Nothing has been extracted from this document yet',
    })
  })
})
