/**
 * The only door the profile check uses to talk to a social platform.
 *
 * It owns the connector executor and refuses anything that is not on a fixed
 * list of read-only profile lookups, so "reading a profile" cannot become
 * "changing one" by a later edit to a caller. Writing a profile or posting
 * stays behind the approval routes (see the trust-tier gate test).
 */
import type { Db } from 'mongodb'
import { ConnectorActionExecutor } from '@lifekeel/workflows'
import type { ConnectorRead } from './channel-profiles.js'

/** `connector:action` pairs that only GET a profile. Nothing else may pass. */
export const READ_ONLY_PROFILE_ACTIONS: ReadonlySet<string> = new Set([
  'twitter_x:getUsersMe',
  'facebook_pages:get_profile',
  'instagram_business:get_profile',
  'threads:get_profile',
])

export function profileReader(db: Db): ConnectorRead {
  const exec = new ConnectorActionExecutor(db)
  return async (tenantId, connectorId, actionId, params) => {
    if (!READ_ONLY_PROFILE_ACTIONS.has(`${connectorId}:${actionId}`))
      throw new Error(
        `profile reader refused ${connectorId}:${actionId} — it only runs read-only profile lookups`,
      )
    return exec.execute(tenantId, connectorId, actionId, params)
  }
}
