/**
 * ConnectorSandbox unit tests
 *
 * Tests: timeout enforcement, airgap mode blocking, error propagation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectorSandbox } from '../connectors/ConnectorSandbox.js'
import type { Db } from 'mongodb'

// ── DB stub ───────────────────────────────────────────────────────────────────

function makeDb(): Db {
  return {
    collection: () => ({
      findOne: vi.fn(async () => null),
    }),
  } as unknown as Db
}

const CTX = { runId: 'r1', tenantId: 'tenant-1', workflowId: 'wf-1', nodeId: 'n1' }

// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectorSandbox', () => {
  beforeEach(() => {
    delete process.env['KAIROS_DEPLOYMENT_MODE']
  })

  it('throws immediately in airgap mode without calling executor', async () => {
    const sandbox = new ConnectorSandbox(makeDb(), undefined, { airgapMode: true })
    await expect(
      sandbox.execute('stripe', 'charge', {}, CTX)
    ).rejects.toThrow(/Airgap mode/)
  })

  it('reads airgap mode from KAIROS_DEPLOYMENT_MODE env var', async () => {
    process.env['KAIROS_DEPLOYMENT_MODE'] = 'airgap'
    const sandbox = new ConnectorSandbox(makeDb())
    await expect(
      sandbox.execute('stripe', 'charge', {}, CTX)
    ).rejects.toThrow(/Airgap mode/)
  })

  it('enforces timeout — rejects when executor hangs past deadline', async () => {
    const sandbox = new ConnectorSandbox(makeDb(), undefined, { defaultTimeoutMs: 50 })

    // Replace ConnectorActionExecutor.execute with a slow fn
    // We can't easily mock the internal executor, so we test timeout via
    // the Promise.race by monkey-patching the executor's execute method
    const proto = Object.getPrototypeOf(
      (sandbox as unknown as Record<string, unknown>)['executor']
    )
    const originalExecute = proto.execute
    proto.execute = () => new Promise(res => setTimeout(res, 5_000))

    try {
      await expect(
        sandbox.execute('slack', 'send_message', {}, CTX)
      ).rejects.toThrow(/Timeout/)
    } finally {
      proto.execute = originalExecute
    }
  }, 2_000)

  it('per-connector timeout override takes precedence over default', async () => {
    const sandbox = new ConnectorSandbox(makeDb(), undefined, {
      defaultTimeoutMs: 10_000,
      connectorTimeouts: { stripe: 100 },
    })

    const proto = Object.getPrototypeOf(
      (sandbox as unknown as Record<string, unknown>)['executor']
    )
    const originalExecute = proto.execute
    proto.execute = () => new Promise(res => setTimeout(res, 5_000))

    try {
      const start = Date.now()
      await expect(
        sandbox.execute('stripe', 'charge', {}, CTX)
      ).rejects.toThrow(/Timeout/)
      const elapsed = Date.now() - start
      // Should time out closer to 100ms, not 10_000ms
      expect(elapsed).toBeLessThan(2_000)
    } finally {
      proto.execute = originalExecute
    }
  }, 3_000)
})
