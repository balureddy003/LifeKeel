/**
 * Edition gate — runtime check for LifeKeel edition.
 *
 * Tier hierarchy:
 *   community  MIT open-source packages (@lifekeel/engine, @lifekeel/platform core)
 *   busl       Source-available BUSL-1.1 packages (@lifekeel/workflows, @lifekeel/pipeline)
 *   enterprise Enterprise-only packages (@lifekeel/ee-*)
 *
 * Set LIFEKEEL_EDITION=enterprise in env to unlock enterprise features.
 * Do NOT set this unless you have a valid enterprise licence agreement.
 */

export type LifeKeelEdition = 'community' | 'busl' | 'enterprise'

export interface EditionInfo {
  edition: LifeKeelEdition
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
 * 1. LIFEKEEL_EDITION env var (explicit override)
 * 2. LIFEKEEL_ENTERPRISE_KEY env var (key implies enterprise edition)
 * 3. Default: 'busl' (workflows + pipeline available, no EE)
 */
export function getEdition(): LifeKeelEdition {
  const explicit = process.env.LIFEKEEL_EDITION as LifeKeelEdition | undefined
  if (explicit && ['community', 'busl', 'enterprise'].includes(explicit)) {
    return explicit
  }
  if (process.env.LIFEKEEL_ENTERPRISE_KEY) {
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
    enterpriseLicenceKey: process.env.LIFEKEEL_ENTERPRISE_KEY ?? null,
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
 * // In @lifekeel/ee-rbac bootstrap:
 * requireEdition('enterprise', 'RBAC')
 */
export function requireEdition(required: LifeKeelEdition, featureName: string): void {
  const tiers: LifeKeelEdition[] = ['community', 'busl', 'enterprise']
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
    public readonly required: LifeKeelEdition,
    public readonly current: LifeKeelEdition,
  ) {
    super(
      `"${feature}" requires LifeKeel ${required} edition. ` +
      `Current edition: ${current}. ` +
      `Contact hello@lifekeel.dev to upgrade.`
    )
    this.name = 'EditionError'
  }
}
