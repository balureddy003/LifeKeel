import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HANDLED_WEBHOOK_EVENTS, loadStripeConfig } from '../stripe-config.js'

// The webhook endpoint is registered from definitions/stripe-config.yaml. An
// event subscribed there with no `case` in the handler is silently dropped
// (Stripe gets a 200, nothing happens); an event handled with no subscription
// never arrives. This test keeps the two lists identical.
const billingSource = readFileSync(join(__dirname, '../../routes/billing.ts'), 'utf8')

describe('stripe-config.yaml webhook events', () => {
  const config = loadStripeConfig()

  it('every subscribed event has a handler case in routes/billing.ts', () => {
    for (const ev of config.webhook.events) {
      expect(billingSource, `no handler for ${ev}`).toContain(`case '${ev}'`)
    }
  })

  it('every event routes/billing.ts handles is subscribed in the config', () => {
    const handled = [...billingSource.matchAll(/case '([a-z_.]+\.[a-z_.]+)'/g)]
      .map((m) => m[1]!)
      .filter((e) => /^(checkout|customer|invoice|charge)\./.test(e))
    expect([...new Set(handled)].sort()).toEqual([...config.webhook.events].sort())
  })

  it('HANDLED_WEBHOOK_EVENTS matches the config', () => {
    expect([...HANDLED_WEBHOOK_EVENTS].sort()).toEqual([...config.webhook.events].sort())
  })
})
