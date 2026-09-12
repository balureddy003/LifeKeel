/**
 * Deployment mode configuration.
 *
 * KAIROS_DEPLOYMENT_MODE=airgap   → forces Ollama, blocks external LLM/connector calls
 * KAIROS_DEPLOYMENT_MODE=cloud    → full external connectivity, audit logging enabled
 * KAIROS_DEPLOYMENT_MODE=dev      → default (no restrictions)
 */

import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'deployment', version: '0.0.0' })

export type DeploymentMode = 'dev' | 'cloud' | 'airgap' | 'accountant'

export interface DeploymentConfig {
  mode: DeploymentMode
  allowExternalLlm: boolean
  allowExternalConnectors: boolean
  auditLogEnabled: boolean
  ollamaBaseUrl: string
  enforceHttps: boolean
  maxWorkflowRunsPerMinute: number
}

const rawMode = (process.env['KAIROS_DEPLOYMENT_MODE'] ?? 'dev').toLowerCase()

function resolveMode(raw: string): DeploymentMode {
  if (raw === 'airgap') return 'airgap'
  if (raw === 'cloud')  return 'cloud'
  if (raw === 'accountant') return 'accountant'
  return 'dev'
}

const mode = resolveMode(rawMode)

export const deploymentConfig: DeploymentConfig = {
  mode,
  allowExternalLlm:       mode !== 'airgap',
  allowExternalConnectors: mode !== 'airgap',
  auditLogEnabled:         mode !== 'dev',
  ollamaBaseUrl:           process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
  enforceHttps:            mode === 'cloud' || mode === 'accountant',
  maxWorkflowRunsPerMinute: mode === 'cloud' || mode === 'accountant' ? 100 : mode === 'airgap' ? 20 : 1000,
}

/** Middleware factory — warns when external URL detected in airgap mode */
export function airgapGuard(url: string, context: string): void {
  if (mode !== 'airgap') return
  if (url.startsWith('http://localhost') || url.startsWith('http://127.') || url.startsWith('http://ollama')) return

  log.warn({ context, url: url.slice(0, 80) }, 'External URL blocked in airgap mode')
  throw new Error(`External network access blocked in airgap deployment mode. URL: ${url.slice(0, 60)}`)
}

/** Log deployment mode at startup */
export function logDeploymentMode(): void {
  const NOTES: Record<DeploymentMode, string> = {
    dev:    'All external connections allowed. Not for production.',
    cloud:  'Full cloud mode — audit log, HTTPS enforced, rate limits active.',
    airgap: 'Air-gapped — all LLM calls routed to Ollama. External connectors blocked.',
    accountant: 'Cloud profile with multi-client accountant and white-label surfaces.',
  }
  log.info({ mode, note: NOTES[mode] }, `Deployment mode: ${mode.toUpperCase()}`)
  if (mode === 'airgap') {
    log.info({ ollama_url: deploymentConfig.ollamaBaseUrl }, 'Ollama base URL')
  }
}
