import { describe, expect, it, vi } from 'vitest'
import { querySearchAnalytics } from '../search-console.js'
import { runGa4Report } from '../ga4.js'
import { GoogleReadError } from '../google-read.js'

const token = async () => 'tok'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('querySearchAnalytics', () => {
  it('posts the right read-only query to the encoded property, with final data', async () => {
    const f = vi.fn(async () =>
      json({ rows: [{ keys: ['wills'], clicks: 1, impressions: 10, ctr: 0.1, position: 5 }] }),
    )
    const rows = await querySearchAnalytics({
      token,
      siteUrl: 'sc-domain:lifekeel.co.uk',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      dimensions: ['query'],
      fetchImpl: f as never,
    })
    expect(rows).toHaveLength(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Alifekeel.co.uk/searchAnalytics/query',
    )
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toMatchObject({
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      dimensions: ['query'],
      dataState: 'final',
      startRow: 0,
    })
  })

  it('pages until a short page, and stops at the row cap', async () => {
    const page = (n: number) => ({
      rows: Array.from({ length: n }, (_, i) => ({
        keys: [`q${i}`],
        clicks: 0,
        impressions: 1,
        ctr: 0,
        position: 1,
      })),
    })
    const f = vi.fn()
    f.mockResolvedValueOnce(json(page(3)))
      .mockResolvedValueOnce(json(page(3)))
      .mockResolvedValueOnce(json(page(1)))
    const rows = await querySearchAnalytics({
      token,
      siteUrl: 's',
      startDate: 'a',
      endDate: 'b',
      dimensions: ['query'],
      pageSize: 3,
      fetchImpl: f as never,
    })
    expect(rows).toHaveLength(7)
    expect(
      JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).startRow,
    ).toBe(3)

    const g = vi.fn(async () => json(page(3)))
    const capped = await querySearchAnalytics({
      token,
      siteUrl: 's',
      startDate: 'a',
      endDate: 'b',
      dimensions: ['query'],
      pageSize: 3,
      maxRows: 5,
      fetchImpl: g as never,
    })
    expect(capped.length).toBeLessThanOrEqual(6)
    expect(g.mock.calls.length).toBe(2)
  })

  it('turns a 403 into a forbidden error without exposing the token', async () => {
    const f = vi.fn(async () =>
      json({ error: { message: 'User does not have sufficient permission' } }, 403),
    )
    const err = await querySearchAnalytics({
      token,
      siteUrl: 's',
      startDate: 'a',
      endDate: 'b',
      dimensions: ['page'],
      fetchImpl: f as never,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleReadError)
    expect(err.kind).toBe('forbidden')
    expect(err.message).not.toContain('tok')
  })

  it('reports a thrown network error as a failed read', async () => {
    const f = vi.fn(async () => {
      throw new Error('socket hang up')
    })
    const err = await querySearchAnalytics({
      token,
      siteUrl: 's',
      startDate: 'a',
      endDate: 'b',
      dimensions: ['date'],
      fetchImpl: f as never,
    }).catch((e) => e)
    expect(err.kind).toBe('failed')
  })
})

describe('runGa4Report', () => {
  it('posts a report request and parses string metrics into numbers', async () => {
    const f = vi.fn(async () =>
      json({
        rows: [
          {
            dimensionValues: [{ value: 'google' }, { value: 'organic' }],
            metricValues: [{ value: '12' }, { value: '9' }, { value: '2' }],
          },
        ],
      }),
    )
    const rows = await runGa4Report({
      token,
      propertyId: '123456',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      dimensions: ['sessionSource', 'sessionMedium'],
      metrics: ['sessions', 'engagedSessions', 'keyEvents'],
      fetchImpl: f as never,
    })
    expect(rows).toEqual([{ dims: ['google', 'organic'], metrics: [12, 9, 2] }])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport')
    const body = JSON.parse(init.body as string)
    expect(body.dimensions).toEqual([{ name: 'sessionSource' }, { name: 'sessionMedium' }])
    expect(body.metrics.map((m: { name: string }) => m.name)).toEqual([
      'sessions',
      'engagedSessions',
      'keyEvents',
    ])
    expect(body.dateRanges).toEqual([{ startDate: '2026-10-01', endDate: '2026-10-03' }])
  })

  it('maps quota and permission errors', async () => {
    const q = await runGa4Report({
      token,
      propertyId: '1',
      startDate: 'a',
      endDate: 'b',
      dimensions: ['date'],
      metrics: ['sessions'],
      fetchImpl: (async () => json({}, 429)) as never,
    }).catch((e) => e)
    expect(q.kind).toBe('quota')
    const p = await runGa4Report({
      token,
      propertyId: '1',
      startDate: 'a',
      endDate: 'b',
      dimensions: ['date'],
      metrics: ['sessions'],
      fetchImpl: (async () => json({}, 403)) as never,
    }).catch((e) => e)
    expect(p.kind).toBe('forbidden')
  })
})
