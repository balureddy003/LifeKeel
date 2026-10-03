import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerShareRoutes } from '../share.js'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  await registerShareRoutes(app)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('GET /share/readiness', () => {
  it('serves per-score OG tags with a redirect to the quiz', async () => {
    const res = await app.inject({ method: 'GET', url: '/share/readiness?s=74' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('Family Readiness 74/100')
    expect(res.body).toContain('og:title')
    expect(res.body).toContain('utm_campaign=score_share')
    expect(res.body).toContain('http-equiv="refresh"')
    expect(res.body).toContain('noindex')
  })

  it('clamps out-of-range scores to the generic card', async () => {
    for (const s of ['-5', '101', 'abc', '99999']) {
      const res = await app.inject({ method: 'GET', url: `/share/readiness?s=${s}` })
      expect(res.body).not.toContain(`${s}/100`)
      expect(res.body).toContain('og:title')
    }
  })

  it('escapes HTML in the interpolated strings', async () => {
    const res = await app.inject({ method: 'GET', url: '/share/readiness?s=<script>' })
    expect(res.body).not.toContain('<script>')
  })

  it('points og:image at the per-score API render', async () => {
    const res = await app.inject({ method: 'GET', url: '/share/readiness?s=74' })
    expect(res.body).toContain('/share/readiness/og.png?s=74')
    expect(res.body).toContain('og:image:width')
  })
})

describe('GET /share/readiness/og.png', () => {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  it('renders a real PNG for a valid score', async () => {
    const res = await app.inject({ method: 'GET', url: '/share/readiness/og.png?s=74' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.headers['cache-control']).toContain('immutable')
    expect(res.rawPayload.subarray(0, 4)).toEqual(PNG_MAGIC)
    expect(res.rawPayload.length).toBeGreaterThan(1000)
  })

  it('renders the generic card for an invalid score', async () => {
    const res = await app.inject({ method: 'GET', url: '/share/readiness/og.png?s=999' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
  })
})
