import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'

export type PlatformRole =
  | 'support'
  | 'marketing_operator'
  | 'finance_operator'
  | 'operations'
  | 'platform_admin'
  | 'super_admin'

export type OperatorPermission =
  | 'overview.read'
  | 'users.read'
  | 'users.manage'
  | 'tenants.read'
  | 'tenants.manage'
  | 'marketing.read'
  | 'marketing.manage'
  | 'operations.read'
  | 'operations.manage'
  | 'billing.read'
  | 'billing.manage'
  | 'configuration.read'
  | 'configuration.manage'
  | 'operators.manage'
  | 'audit.read'
  | 'leads.read'
  | 'leads.manage'
  | 'promotions.read'
  | 'promotions.manage'
  | 'support.read'
  | 'support.manage'

export interface OperatorContext {
  user_id: string
  tenant_id: string
  roles: PlatformRole[]
  source: 'database' | 'bootstrap'
}

interface PlatformOperatorDoc {
  user_id: string
  roles: PlatformRole[]
  status: 'active' | 'suspended'
}

const ROLE_PERMISSIONS: Record<PlatformRole, readonly OperatorPermission[]> = {
  support: [
    'overview.read',
    'users.read',
    'tenants.read',
    'operations.read',
    'leads.read',
    'audit.read',
    'support.read',
    'support.manage',
  ],
  marketing_operator: [
    'overview.read',
    'marketing.read',
    'marketing.manage',
    'leads.read',
    'leads.manage',
    'promotions.read',
    'audit.read',
  ],
  finance_operator: [
    'overview.read',
    'billing.read',
    'billing.manage',
    'tenants.read',
    'leads.read',
    'promotions.read',
    'promotions.manage',
    'audit.read',
  ],
  operations: [
    'overview.read',
    'users.read',
    'tenants.read',
    'marketing.read',
    'operations.read',
    'operations.manage',
    'leads.read',
    'audit.read',
    'support.read',
  ],
  platform_admin: [
    'overview.read',
    'users.read',
    'users.manage',
    'tenants.read',
    'tenants.manage',
    'marketing.read',
    'marketing.manage',
    'operations.read',
    'operations.manage',
    'billing.read',
    'billing.manage',
    'configuration.read',
    'configuration.manage',
    'leads.read',
    'leads.manage',
    'promotions.read',
    'promotions.manage',
    'audit.read',
    'support.read',
    'support.manage',
  ],
  super_admin: [
    'overview.read',
    'users.read',
    'users.manage',
    'tenants.read',
    'tenants.manage',
    'marketing.read',
    'marketing.manage',
    'operations.read',
    'operations.manage',
    'billing.read',
    'billing.manage',
    'configuration.read',
    'configuration.manage',
    'leads.read',
    'leads.manage',
    'promotions.read',
    'promotions.manage',
    'operators.manage',
    'audit.read',
    'support.read',
    'support.manage',
  ],
}

export function hasOperatorPermission(
  roles: PlatformRole[],
  permission: OperatorPermission,
): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission))
}

/** Which roles carry a permission — used by autopilot assignment to find
 *  operators eligible for a given work stream (platform_operators docs
 *  store role names, not resolved permissions). */
export function rolesWithPermission(permission: OperatorPermission): PlatformRole[] {
  return (Object.keys(ROLE_PERMISSIONS) as PlatformRole[]).filter((r) =>
    ROLE_PERMISSIONS[r].includes(permission),
  )
}

/** Union of all permissions granted by the operator's roles — used by
 *  /operator/me so the console can hide nav items that would 403. The
 *  backend stays authoritative; this is for UX, not enforcement. */
export function resolvePermissions(roles: PlatformRole[]): OperatorPermission[] {
  const granted = new Set<OperatorPermission>()
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) granted.add(permission)
  }
  return [...granted].sort()
}

function bootstrapUserIds(): Set<string> {
  return new Set(
    (process.env['PLATFORM_OPERATOR_USER_IDS'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

// PLATFORM_OPERATOR_BOOTSTRAP_UNTIL — ISO timestamp after which the env
// break-glass path is dead even with zero DB super_admins. Break-glass that
// never expires is a standing super_admin backdoor; the deploy that seeds
// the first DB super_admin should set this to seed-time + a short margin.
function bootstrapExpired(): boolean {
  const until = process.env['PLATFORM_OPERATOR_BOOTSTRAP_UNTIL']
  if (!until) return false
  const expiry = Date.parse(until)
  return Number.isFinite(expiry) && Date.now() > expiry
}

// Warn once per process per user — every request would spam the log, but a
// break-glass resolution should leave a trace that points at the fix.
const bootstrapWarned = new Set<string>()

export async function resolveOperator(
  db: Db,
  request: FastifyRequest,
): Promise<OperatorContext | null> {
  const auth = request.authContext
  if (!auth || auth.demo) return null

  const operators = db.collection<PlatformOperatorDoc>('platform_operators')
  const operator = await operators.findOne({ user_id: auth.user_id })
  if (operator?.status === 'active') {
    return {
      user_id: auth.user_id,
      tenant_id: auth.tenant_id,
      roles: operator.roles,
      source: 'database',
    }
  }
  // An explicit suspension beats the env bootstrap — a suspended operator
  // must not regain access just because their id is still in the env list.
  if (operator?.status === 'suspended') return null

  // PLATFORM_OPERATOR_USER_IDS is break-glass only: it grants super_admin
  // until a DB-managed super_admin exists, then goes dormant. It re-activates
  // if every DB super_admin is suspended/removed — that's the recovery path
  // that makes it safe to remove the env var entirely after seeding.
  if (bootstrapUserIds().has(auth.user_id)) {
    if (bootstrapExpired()) {
      if (!bootstrapWarned.has(`${auth.user_id}:expired`)) {
        bootstrapWarned.add(`${auth.user_id}:expired`)
        request.log?.warn(
          { user_id: auth.user_id },
          'bootstrap operator denied — PLATFORM_OPERATOR_BOOTSTRAP_UNTIL has passed; use DB-managed operators',
        )
      }
      return null
    }
    const activeSuperAdmins = await operators.countDocuments({
      status: 'active',
      roles: 'super_admin',
    })
    if (activeSuperAdmins > 0) return null
    if (!bootstrapWarned.has(auth.user_id)) {
      bootstrapWarned.add(auth.user_id)
      request.log?.warn(
        { user_id: auth.user_id },
        'bootstrap operator access via PLATFORM_OPERATOR_USER_IDS — seed a DB super_admin to disable it',
      )
    }
    return {
      user_id: auth.user_id,
      tenant_id: auth.tenant_id,
      roles: ['super_admin'],
      source: 'bootstrap',
    }
  }
  return null
}

export interface RequireOperatorOptions {
  /** Destructive or bulk actions require a session minted within the
   *  step-up window — a stolen long-lived token alone can't run them.
   *  The operator re-authenticates (fresh login) and retries. */
  stepUp?: boolean
}

const STEP_UP_WINDOW_SEC = () => Number(process.env['OPERATOR_STEP_UP_WINDOW_SEC']) || 15 * 60

export function requireOperator(
  db: Db,
  permission: OperatorPermission,
  opts: RequireOperatorOptions = {},
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const operator = await resolveOperator(db, request)
    if (!operator) {
      await reply.status(403).send({ error: 'Platform operator access required' })
      return
    }
    if (!hasOperatorPermission(operator.roles, permission)) {
      await reply.status(403).send({ error: `Missing operator permission: ${permission}` })
      return
    }
    if (opts.stepUp) {
      const iat = request.authContext?.iat
      const ageSec = typeof iat === 'number' ? Date.now() / 1000 - iat : Number.POSITIVE_INFINITY
      if (ageSec > STEP_UP_WINDOW_SEC()) {
        await reply.status(403).send({
          error: 'Recent authentication required for this action',
          code: 'step_up_required',
          max_age_sec: STEP_UP_WINDOW_SEC(),
        })
        return
      }
    }
    request.operatorContext = operator
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    operatorContext?: OperatorContext
  }
}
