export type ProductRole = 'owner' | 'admin' | 'analyst' | 'operator' | 'viewer'
export type ProductResource = 'insights' | 'goals' | 'workflows' | 'detectors' | 'connectors' | 'analytics' | 'users' | 'settings' | 'audit'
export type ProductAction = 'read' | 'create' | 'update' | 'delete' | 'approve' | 'assign' | 'export'

const ROLE_LEVEL: Record<ProductRole, number> = { viewer: 0, analyst: 1, operator: 2, admin: 3, owner: 4 }

export function canPerform(roles: string[], resource: ProductResource, action: ProductAction): boolean {
  const level = Math.max(-1, ...roles.map(role => ROLE_LEVEL[role as ProductRole] ?? -1))
  if (level >= 3) return true
  if (action === 'read') return level >= 0
  if (resource === 'insights' && ['approve', 'update', 'create'].includes(action)) return level >= 1
  if (resource === 'insights' && action === 'assign') return level >= 2
  if (resource === 'goals' && ['create', 'update'].includes(action)) return level >= 1
  if (['detectors', 'workflows'].includes(resource) && ['create', 'update', 'delete'].includes(action)) return level >= 2
  if (resource === 'analytics' && action === 'export') return level >= 1
  return false
}
