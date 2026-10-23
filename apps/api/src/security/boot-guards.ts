/**
 * Boot guards for flags that open a public surface (CLOUDFLARE_INTEGRATION.md §8.4).
 *
 * Each guard is a pure function of the environment so it can be tested
 * without booting the server. server.ts calls `assertBootGuards` once at
 * startup and refuses to start on any violation.
 *
 * "Non-dev" follows the deployment mode, not NODE_ENV: a 'staging' cloud
 * deploy is still a public deploy.
 */

export type Env = Record<string, string | undefined>

export interface BootGuardResult {
  /** Fatal: the process must not start. */
  violations: string[]
  /** Accepted downgrades that must be visible in the boot log. */
  exceptions: string[]
}

export function evaluateBootGuards(env: Env, mode: string): BootGuardResult {
  const violations: string[] = []
  const exceptions: string[] = []
  const nonDev = mode !== 'dev'
  if (!nonDev) return { violations, exceptions }

  // /documentation is the full route inventory (API9). Off unless an
  // exception is written down and logged.
  if (env['ENABLE_API_DOCS'] === 'true') {
    const reason = env['API_DOCS_EXCEPTION']?.trim()
    if (!reason) {
      violations.push(
        'ENABLE_API_DOCS=true outside dev requires API_DOCS_EXCEPTION (a recorded exception reference)',
      )
    } else {
      exceptions.push(`ENABLE_API_DOCS=true (API_DOCS_EXCEPTION=${reason})`)
    }
  }

  // /auth/token mints an admin token for any tenant named in the body.
  if (env['ALLOW_DEMO_TOKENS']) {
    violations.push('ALLOW_DEMO_TOKENS must not be set outside dev')
  }

  // /metrics stays on the open list (so the global hook does not 401 the
  // opaque scrape token) and checks this token itself.
  const scrape = env['METRICS_SCRAPE_TOKEN'] ?? ''
  if (scrape.length < 24) {
    violations.push('METRICS_SCRAPE_TOKEN must be set (at least 24 characters) outside dev')
  }

  return { violations, exceptions }
}

/** Whether the Swagger UI routes are registered (and therefore listed as open). */
export function apiDocsEnabled(env: Env, mode: string): boolean {
  if (mode === 'dev') return true
  return env['ENABLE_API_DOCS'] === 'true' && Boolean(env['API_DOCS_EXCEPTION']?.trim())
}
