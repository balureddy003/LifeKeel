import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatResult, main, parseArgs } from '../stripe-cli.js'
import type { ReconcileResult } from '../stripe-reconcile.js'

describe('stripe-cli parseArgs', () => {
  it('is a read-only dry-run by default and reads origins from the environment', () => {
    const a = parseArgs([], { STRIPE_API_ORIGIN: 'https://api.x', LIFEKEEL_URL: 'https://app.x' })
    expect(a).toMatchObject({
      apply: false,
      apiOrigin: 'https://api.x',
      appOrigin: 'https://app.x',
      webhookCreate: true,
    })
  })

  it('parses flags and --only', () => {
    const a = parseArgs(['--apply', '--only', 'product,price', '--no-webhook-create', '--json'], {})
    expect(a).toMatchObject({
      apply: true,
      json: true,
      webhookCreate: false,
      only: ['product', 'price'],
    })
  })

  it('rejects unknown flags and unknown objects', () => {
    expect(() => parseArgs(['--nope'], {})).toThrow(/Unknown argument/)
    expect(() => parseArgs(['--only', 'coupons'], {})).toThrow(/unknown object/)
    expect(() => parseArgs(['--api-origin'], {})).toThrow(/needs a value/)
  })
})

describe('stripe-cli main safety rails', () => {
  afterEach(() => vi.restoreAllMocks())

  it('needs a key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await main([], {})).toBe(1)
  })

  it('refuses --apply against a live key without --allow-live', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = await main(['--apply', '--no-webhook-create'], { STRIPE_SECRET_KEY: 'sk_live_x' })
    expect(code).toBe(1)
    expect(err.mock.calls.join(' ')).toContain('LIVE')
  })

  it('refuses --apply that could create the webhook without somewhere to put the secret', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = await main(['--apply'], { STRIPE_SECRET_KEY: 'sk_test_x' })
    expect(code).toBe(1)
    expect(err.mock.calls.join(' ')).toContain('--webhook-secret-file')
  })
})

describe('formatResult', () => {
  const base: ReconcileResult = {
    mode: 'test',
    applied: false,
    drift: true,
    actions: [
      {
        object: 'price',
        key: 'keel_plus_gbp_monthly',
        op: 'replace',
        details: ['unit_amount 799 -> 999'],
      },
    ],
    errors: [],
    ids: { prices: {} },
  }

  it('shows the diff and tells the operator how to apply', () => {
    const out = formatResult(base)
    expect(out).toContain('dry-run')
    expect(out).toContain('unit_amount 799 -> 999')
    expect(out).toContain('--apply')
  })

  it('never prints a webhook signing secret', () => {
    const out = formatResult({ ...base, applied: true, webhookSecret: 'whsec_SHOULD_NOT_APPEAR' })
    expect(out).not.toContain('whsec_')
  })
})
