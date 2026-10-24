import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import {
  evaluateTurnstileBoot,
  registerTurnstile,
  turnstileConfig,
  verifyTurnstileToken,
  type TurnstileConfig,
} from '../turnstile.js'

const CFG: TurnstileConfig = {
  mode: 'enforce',
  secret: '1x0000000000000000000000000000000AA',
  allowedHostnames: ['app.lifekeel.co.uk'],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const pass = (action = 'login') =>
  json({ success: true, hostname: 'app.lifekeel.co.uk', action, 'error-codes': [] })

describe('verifyTurnstileToken', () => {
  it('accepts a matching hostname and action', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pass())
    expect(await verifyTurnstileToken('tok', '1.2.3.4', 'login', CFG, fetchImpl)).toEqual({
      result: 'ok',
    })
    const body = fetchImpl.mock.calls[0]![1].body as URLSearchParams
    expect(body.get('remoteip')).toBe('1.2.3.4')
    expect(body.get('secret')).toBe(CFG.secret)
    expect(body.get('idempotency_key')).toMatch(/[0-9a-f-]{36}/)
  })

  it('refuses a token minted for another action', async () => {
    const r = await verifyTurnstileToken('tok', 'ip', 'signup', CFG, async () => pass('login'))
    expect(r).toEqual({ result: 'failed', codes: ['action-mismatch'] })
  })

  it('refuses a hostname outside the allow-list', async () => {
    const r = await verifyTurnstileToken('tok', 'ip', 'login', CFG, async () =>
      json({ success: true, hostname: 'evil.example', action: 'login' }),
    )
    expect(r).toEqual({ result: 'failed', codes: ['hostname-mismatch'] })
  })

  it('reports Cloudflare error codes on failure', async () => {
    const r = await verifyTurnstileToken('tok', 'ip', 'login', CFG, async () =>
      json({ success: false, 'error-codes': ['invalid-input-response'] }),
    )
    expect(r).toEqual({ result: 'failed', codes: ['invalid-input-response'] })
  })

  it('treats a malformed body as a failure, not a pass', async () => {
    const r = await verifyTurnstileToken('tok', 'ip', 'login', CFG, async () => json({ ok: 1 }))
    expect(r.result).toBe('failed')
  })

  it('retries once with the same idempotency key, then reports unavailable', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(json({}, 502))
    expect(await verifyTurnstileToken('tok', 'ip', 'login', CFG, fetchImpl)).toEqual({
      result: 'unavailable',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const k1 = (fetchImpl.mock.calls[0]![1].body as URLSearchParams).get('idempotency_key')
    const k2 = (fetchImpl.mock.calls[1]![1].body as URLSearchParams).get('idempotency_key')
    expect(k1).toBe(k2)
  })

  it('recovers when the retry succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(pass())
    expect((await verifyTurnstileToken('tok', 'ip', 'login', CFG, fetchImpl)).result).toBe('ok')
  })

  it('rejects absent and oversize tokens without a network call', async () => {
    const fetchImpl = vi.fn()
    expect((await verifyTurnstileToken(undefined, 'ip', 'login', CFG, fetchImpl)).result).toBe(
      'missing',
    )
    expect(
      (await verifyTurnstileToken('x'.repeat(2049), 'ip', 'login', CFG, fetchImpl)).result,
    ).toBe('missing')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('turnstile config and boot', () => {
  it('defaults off in dev and enforce elsewhere', () => {
    expect(turnstileConfig({}, 'dev').mode).toBe('off')
    expect(turnstileConfig({}, 'cloud').mode).toBe('enforce')
    expect(turnstileConfig({ TURNSTILE_MODE: 'monitor' }, 'cloud').mode).toBe('monitor')
  })

  it('fails boot without a secret or hostnames, and logs a non-dev downgrade', () => {
    expect(evaluateTurnstileBoot({}, 'cloud').violations).toHaveLength(2)
    const monitor = evaluateTurnstileBoot(
      {
        TURNSTILE_MODE: 'monitor',
        TURNSTILE_SECRET_KEY: 'k',
        TURNSTILE_ALLOWED_HOSTNAMES: 'a.example',
      },
      'cloud',
    )
    expect(monitor.violations).toEqual([])
    expect(monitor.exceptions.join()).toContain('monitor')
  })
})

describe('route gate', () => {
  afterEach(() => vi.restoreAllMocks())

  async function build(cfg: TurnstileConfig, fetchImpl: typeof fetch) {
    const app = Fastify()
    await app.register(rateLimit, {
      global: true,
      max: 2,
      timeWindow: '1 minute',
      hook: 'preHandler',
    })
    registerTurnstile(app, { config: () => cfg, fetch: fetchImpl })
    app.post('/auth/login', { config: { turnstile: 'login' } }, async () => ({ ok: true }))
    app.post('/open', async () => ({ ok: true }))
    await app.ready()
    return app
  }

  it('enforce: 400 without a token, 403 on failure, 200 on pass', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ success: false, 'error-codes': ['x'] }))
      .mockResolvedValueOnce(pass())
    const app = await build(CFG, fetchImpl as unknown as typeof fetch)
    expect((await app.inject({ method: 'POST', url: '/auth/login' })).json()).toEqual({
      error: 'captcha_required',
    })
    const headers = { 'cf-turnstile-token': 'tok' }
    const failed = await app.inject({ method: 'POST', url: '/auth/login', headers })
    expect(failed.statusCode).toBe(403)
    expect(failed.json()).toEqual({ error: 'captcha_failed' })
    // Rate limit (max 2) is exhausted before the third siteverify call.
    const limited = await app.inject({ method: 'POST', url: '/auth/login', headers })
    expect(limited.statusCode).toBe(429)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('enforce: 503 when siteverify is unreachable', async () => {
    const app = await build(CFG, (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'cf-turnstile-token': 'tok' },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'captcha_unavailable' })
    await app.close()
  })

  it('monitor lets a failing request through; routes without config are untouched', async () => {
    const app = await build({ ...CFG, mode: 'monitor' }, (async () =>
      json({ success: false })) as unknown as typeof fetch)
    expect((await app.inject({ method: 'POST', url: '/auth/login' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/open' })).statusCode).toBe(200)
    await app.close()
  })

  it('off skips verification entirely', async () => {
    const fetchImpl = vi.fn()
    const app = await build({ ...CFG, mode: 'off' }, fetchImpl as unknown as typeof fetch)
    expect((await app.inject({ method: 'POST', url: '/auth/login' })).statusCode).toBe(200)
    expect(fetchImpl).not.toHaveBeenCalled()
    await app.close()
  })
})
