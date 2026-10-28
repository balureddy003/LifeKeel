/**
 * The frozen identity every Keel module receives. Built only from the
 * server-verified authContext plus a roster lookup — never from the request
 * body or the model. Downstream code takes this object, not raw ids.
 */
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { FamilyGroupDoc, FamilyMemberDoc } from '../routes/family-group.js'
import {
  EDITOR_AUTH_ROLES,
  isMinorMember,
  memberMatchesUser,
} from '../family/family-permissions.js'
import { projectionFor } from './field-classes.js'

export interface KeelContext {
  readonly tenant_id: string
  readonly user_id: string
  readonly roles: readonly string[]
  /** Active roster entry for this user; null before a family exists or after removal. */
  readonly member: FamilyMemberDoc | null
  readonly hasFamily: boolean
  readonly isMinor: boolean
  readonly isOrganizer: boolean
  /** Active adult who holds an editor auth role (can change household facts). */
  readonly isEditor: boolean
  /** Active adult without an editor role: sees the guide read-only. */
  readonly isViewer: boolean
}

export interface AuthIdentity {
  tenant_id: string
  user_id: string
  roles?: readonly string[]
}

export async function buildKeelContext(db: Db, auth: AuthIdentity): Promise<KeelContext> {
  const family = await getTenantCollection<FamilyGroupDoc>(
    db,
    'family_groups',
    auth.tenant_id,
  ).findOne({}, { projection: projectionFor('family_groups') })

  const member = family?.members?.find((m) => memberMatchesUser(m, auth.user_id)) ?? null
  const active = member !== null && member.status === 'active'
  const isMinor = active && isMinorMember(member)
  const roles = Object.freeze([...(auth.roles ?? [])])
  const hasEditorRole = roles.some((r) => EDITOR_AUTH_ROLES.has(r))

  return Object.freeze({
    tenant_id: auth.tenant_id,
    user_id: auth.user_id,
    roles,
    member: active ? member : null,
    hasFamily: active,
    isMinor,
    isOrganizer: active && member.role === 'organizer',
    isEditor: active && !isMinor && hasEditorRole,
    isViewer: active && !isMinor && !hasEditorRole,
  })
}
