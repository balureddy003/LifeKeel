import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'

export type PlatformRole = 'support' | 'marketing_operator' | 'finance_operator' | 'operations' | 'platform_admin' | 'super_admin'

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
  support: ['overview.read', 'users.read', 'tenants.read', 'operations.read', 'leads.read', 'audit.read'],
  marketing_operator: ['overview.read', 'marketing.read', 'marketing.manage', 'leads.read', 'leads.manage', 'promotions.read', 'audit.read'],
  finance_operator: ['overview.read', 'billing.read', 'billing.manage', 'tenants.read', 'leads.read', 'promotions.read', 'promotions.manage', 'audit.read'],
  operations: ['overview.read', 'users.read', 'tenants.read', 'marketing.read', 'operations.read', 'operations.manage', 'leads.read', 'audit.read'],
  platform_admin: [
    'overview.read', 'users.read', 'users.manage', 'tenants.read', 'tenants.manage',
    'marketing.read', 'marketing.manage', 'operations.read', 'operations.manage',
    'billing.read', 'billing.manage', 'configuration.read', 'configuration.manage',
    'leads.read', 'leads.manage', 'promotions.read', 'promotions.manage', 'audit.read',
  ],
  super_admin: [
    'overview.read', 'users.read', 'users.manage', 'tenants.read', 'tenants.manage',
    'marketing.read', 'marketing.manage', 'operations.read', 'operations.manage',
    'billing.read', 'billing.manage', 'configuration.read', 'configuration.manage',
    'leads.read', 'leads.manage', 'promotions.read', 'promotions.manage',
    'operators.manage', 'audit.read',
  ],
}

export function hasOperatorPermission(roles: PlatformRole[], permission: OperatorPermission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission))
}

function bootstrapUserIds(): Set<string> {
  return new Set(
    (process.env['PLATFORM_OPERATOR_USER_IDS'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

export async function resolveOperator(db: Db, request: FastifyRequest): Promise<OperatorContext | null> {
  const auth = request.authContext
  if (!auth || auth.demo) return null

  const operator = await db.collection<PlatformOperatorDoc>('platform_operators').findOne({
    user_id: auth.user_id,
    status: 'active',
  })
  if (operator) {
    return { user_id: auth.user_id, tenant_id: auth.tenant_id, roles: operator.roles, source: 'database' }
  }

  if (bootstrapUserIds().has(auth.user_id)) {
    return { user_id: auth.user_id, tenant_id: auth.tenant_id, roles: ['super_admin'], source: 'bootstrap' }
  }
  return null
}

export function requireOperator(db: Db, permission: OperatorPermission) {
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
    request.operatorContext = operator
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    operatorContext?: OperatorContext
  }
}
