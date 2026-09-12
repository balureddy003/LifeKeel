export type KairosRole = 'owner' | 'admin' | 'operator' | 'analyst' | 'viewer'

export interface SsoRoleMapping {
  idp_claim_name: string
  mappings: Array<{ idp_value: string; kairos_role: KairosRole }>
  default_role: Exclude<KairosRole, 'owner' | 'admin'>
  allow_override: boolean
}

export class RoleResolver {
  resolve(input: {
    override_role?: KairosRole
    idp_claim_values?: string[]
    mapping?: SsoRoleMapping
    jwt_roles?: string[]
  }): KairosRole[] {
    if (input.override_role && (input.mapping?.allow_override ?? true)) return [input.override_role]
    if (input.mapping) {
      for (const value of input.idp_claim_values ?? []) {
        const mapped = input.mapping.mappings.find(entry => entry.idp_value === value)
        if (mapped) return [mapped.kairos_role]
      }
      return [input.mapping.default_role]
    }
    const direct = (input.jwt_roles ?? []).filter(isKairosRole)
    return direct.length > 0 ? [...new Set(direct)] : ['viewer']
  }
}

function isKairosRole(value: string): value is KairosRole {
  return ['owner', 'admin', 'operator', 'analyst', 'viewer'].includes(value)
}
