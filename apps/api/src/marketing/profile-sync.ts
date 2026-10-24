/**
 * Weekly profile check — read-only.
 *
 * For every healthy connection on a platform whose API lets us read the profile
 * (Bluesky, X, Facebook, Instagram, Threads) it reads the live profile and
 * stores the result and the drift against the approved text, exactly as the
 * console's "Check" button does. It never writes to a platform: changing a
 * profile stays a human act (`marketing.profile_update` is never autonomous).
 * Drift then shows up in Mission Control with the approved text to paste.
 */
import type { Db } from 'mongodb'
import { allUsableChannels } from './channels.js'
import {
  DEFAULT_PROFILES,
  SUPPORTS_CHECK,
  computeDrift,
  isProfileChannel,
  readBlueskyProfile,
  readConnectorProfile,
  type ConnectorRead,
  type ProfileDoc,
} from './channel-profiles.js'

export interface ProfileCheckResult {
  checked: number
  failed: { tenant_id: string; channel: string; reason: string }[]
}

export async function checkConnectedProfiles(
  db: Db,
  deps: { connectorRead: ConnectorRead; readBluesky?: typeof readBlueskyProfile },
  now = new Date(),
): Promise<ProfileCheckResult> {
  const col = db.collection<ProfileDoc>('channel_profiles')
  const readBluesky = deps.readBluesky ?? readBlueskyProfile
  const result: ProfileCheckResult = { checked: 0, failed: [] }

  for (const { tenant_id, channel } of await allUsableChannels(db, now)) {
    if (!isProfileChannel(channel) || !SUPPORTS_CHECK.has(channel)) continue
    const doc = await col.findOne({ tenant_id, channel })
    const desired = doc?.desired ?? DEFAULT_PROFILES[channel]
    try {
      const actual =
        channel === 'bluesky'
          ? await readBluesky(desired.handle)
          : await readConnectorProfile(db, tenant_id, channel, deps.connectorRead)
      await col.updateOne(
        { tenant_id, channel },
        {
          $set: {
            actual,
            drift: computeDrift(desired, actual, channel),
            updated_by: 'weekly-profile-check',
            updated_at: now,
          },
          $setOnInsert: { tenant_id, channel, desired, checklist: {} },
        },
        { upsert: true },
      )
      result.checked += 1
    } catch (err) {
      result.failed.push({ tenant_id, channel, reason: String(err).slice(0, 160) })
    }
  }
  return result
}
