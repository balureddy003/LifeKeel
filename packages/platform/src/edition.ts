/**
 * Edition gate — runtime check for Kairos edition.
 *
 * Tier hierarchy:
 *   community  MIT open-source packages (@kairos/engine, @kairos/platform core)
 *   busl       Source-available BUSL-1.1 packages (@kairos/workflows, @kairos/pipeline)
 *   enterprise Enterprise-only packages (@kairos/ee-*)
 *
 * Set KAIROS_EDITION=enterprise in env to unlock enterprise features.
 * Do NOT set this unless you have a valid enterprise licence agreement.
 */

export type KairosEdition = 'community' | 'busl' | 'enterprise'

export interface EditionInfo {
  edition: KairosEdition
  enterpriseLicenceKey: string | null
  features: {
    rbac: boolean
    ssoSaml: boolean
    ssoOidc: boolean
    auditLogExport: boolean
    customRetention: boolean
    onPremise: boolean
  }
}

/**
 * Returns the current edition based on environment variables.
 *
 * Priority:
 * 1. KAIROS_EDITION env var (explicit override)
 * 2. KAIROS_ENTERPRISE_KEY env var (key implies enterprise edition)
 * 3. Default: 'busl' (workflows + pipeline available, no EE)
 */
export function getEdition(): KairosEdition {
  const explicit = process.env.KAIROS_EDITION as KairosEdition | undefined
  if (explicit && ['community', 'busl', 'enterprise'].includes(explicit)) {
    return explicit
  }
  if (process.env.KAIROS_ENTERPRISE_KEY) {
    return 'enterprise'
  }
  return 'busl'
}

/**
 * Full edition info with feature flags.
 */
export function getEditionInfo(): EditionInfo {
  const edition = getEdition()
  const isEnterprise = edition === 'enterprise'

  return {
    edition,
    enterpriseLicenceKey: process.env.KAIROS_ENTERPRISE_KEY ?? null,
    features: {
      rbac:              isEnterprise,
      ssoSaml:           isEnterprise,
      ssoOidc:           isEnterprise,
      auditLogExport:    isEnterprise,
      customRetention:   isEnterprise,
      onPremise:         isEnterprise,
    },
  }
}

/**
 * Assert a feature is available. Throws at startup if not.
 * Use this in package constructors/initialisers to fail fast.
 *
 * @example
 * // In @kairos/ee-rbac bootstrap:
 * requireEdition('enterprise', 'RBAC')
 */
export function requireEdition(required: KairosEdition, featureName: string): void {
  const tiers: KairosEdition[] = ['community', 'busl', 'enterprise']
  const current = getEdition()
  if (tiers.indexOf(current) < tiers.indexOf(required)) {
    throw new EditionError(featureName, required, current)
  }
}

/**
 * Gate a feature flag check. Returns false instead of throwing.
 * Use this in route handlers for graceful 402 responses.
 *
 * @example
 * if (!isFeatureEnabled('rbac')) {
 *   return reply.code(402).send({ error: 'RBAC requires an Enterprise licence.' })
 * }
 */
export function isFeatureEnabled(feature: keyof EditionInfo['features']): boolean {
  return getEditionInfo().features[feature]
}

export class EditionError extends Error {
  constructor(
    public readonly feature: string,
    public readonly required: KairosEdition,
    public readonly current: KairosEdition,
  ) {
    super(
      `"${feature}" requires Kairos ${required} edition. ` +
      `Current edition: ${current}. ` +
      `Contact hello@kairos.dev to upgrade.`
    )
    this.name = 'EditionError'
  }
}
