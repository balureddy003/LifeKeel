/**
 * ConnectorSandbox — wraps ConnectorActionExecutor with:
 *  - Per-connector timeout enforcement via Promise.race
 *  - Structured error logging with run/tenant context
 *  - Airgap guard: blocks external calls when KAIROS_DEPLOYMENT_MODE=airgap
 */

import type { Db } from 'mongodb'
import { ConnectorActionExecutor } from './ConnectorActionExecutor.js'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'connector-sandbox', version: '0.0.0' })

export interface SandboxOptions {
  /** Default timeout in ms (default: 30_000) */
  defaultTimeoutMs?: number
  /** Per-connector timeout overrides */
  connectorTimeouts?: Record<string, number>
  /** Block all external connector calls (airgap mode) */
  airgapMode?: boolean
}

export interface SandboxContext {
  runId: string
  tenantId: string
  workflowId: string
  nodeId: string
}

export class ConnectorSandbox {
  private executor: ConnectorActionExecutor
  private defaultTimeoutMs: number
  private connectorTimeouts: Record<string, number>
  private airgapMode: boolean

  constructor(db: Db, fetchFn?: typeof fetch, opts: SandboxOptions = {}) {
    this.executor = new ConnectorActionExecutor(db, fetchFn)
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000
    this.connectorTimeouts = opts.connectorTimeouts ?? {}
    this.airgapMode = opts.airgapMode ?? (process.env['KAIROS_DEPLOYMENT_MODE'] === 'airgap')
  }

  async execute(
    connectorId: string,
    action: string,
    params: Record<string, unknown>,
    ctx: SandboxContext,
  ): Promise<unknown> {
    // ── Airgap guard ─────────────────────────────────────────
    if (this.airgapMode) {
      throw new Error(
        `[ConnectorSandbox] Airgap mode: external connector call blocked (connector=${connectorId}, action=${action}, run=${ctx.runId})`
      )
    }

    const timeoutMs = this.connectorTimeouts[connectorId] ?? this.defaultTimeoutMs

    // ── Timeout enforcement ───────────────────────────────────
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[ConnectorSandbox] Timeout after ${timeoutMs}ms (connector=${connectorId}, action=${action})`)),
        timeoutMs,
      )
    )

    const execPromise = this.executor.execute(ctx.tenantId, connectorId, action, params)

    try {
      const result = await Promise.race([execPromise, timeoutPromise])
      return result
    } catch (err) {
      log.error({ run_id: ctx.runId, tenant_id: ctx.tenantId, workflow_id: ctx.workflowId, node_id: ctx.nodeId, connector: connectorId, action, err }, 'Connector execution failed')
      throw err
    }
  }
}
