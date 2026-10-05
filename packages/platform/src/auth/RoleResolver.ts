export type LifeKeelRole = 'owner' | 'admin' | 'operator' | 'analyst' | 'viewer'

export interface SsoRoleMapping {
  idp_claim_name: string
  mappings: Array<{ idp_value: string; lifekeel_role: LifeKeelRole }>
  default_role: Exclude<LifeKeelRole, 'owner' | 'admin'>
  allow_override: boolean
}

export class RoleResolver {
  resolve(input: {
    override_role?: LifeKeelRole
    idp_claim_values?: string[]
    mapping?: SsoRoleMapping
    jwt_roles?: string[]
  }): LifeKeelRole[] {
    if (input.override_role && (input.mapping?.allow_override ?? true)) return [input.override_role]
    if (input.mapping) {
      for (const value of input.idp_claim_values ?? []) {
        const mapped = input.mapping.mappings.find(entry => entry.idp_value === value)
        if (mapped) return [mapped.lifekeel_role]
      }
      return [input.mapping.default_role]
    }
    const direct = (input.jwt_roles ?? []).filter(isLifeKeelRole)
    return direct.length > 0 ? [...new Set(direct)] : ['viewer']
  }
}

function isLifeKeelRole(value: string): value is LifeKeelRole {
  return ['owner', 'admin', 'operator', 'analyst', 'viewer'].includes(value)
}
